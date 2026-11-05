"""Run against a fresh disposable PostgreSQL 15 Docker container, never production.

python3 supabase/tests/roast-charge-concurrency.py <container>
Uses the same isolated schema boundary as trial-event.test.ts; not a full reset.
"""

import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

root = Path(__file__).resolve().parents[2]
container = sys.argv[1]
database = "charge_check_" + uuid.uuid4().hex
docker_env = {key: value for key, value in os.environ.items() if key not in {
    "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH",
}}


def command(*args, sql=None, check=True):
    return subprocess.run(
        ["docker", "--host=unix:///var/run/docker.sock", "exec", "-i", container, *args], input=sql,
        text=True, capture_output=True, check=check, env=docker_env,
    )


def query(sql, check=True):
    return command("psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, sql=sql, check=check)


def migration(name):
    return (root / "supabase/migrations" / name).read_text()


def authenticated(owner, statement):
    # UUIDs are generated in this harness; no user SQL is interpolated.
    return f"""BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','{owner}',true), set_config('request.jwt.claim.role','authenticated',true);
{statement}; SELECT pg_sleep(0.03); COMMIT;"""


def race(owner, statements):
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(lambda sql: query(authenticated(owner, sql), check=False), statements))


def usage(owner):
    return json.loads(query(f"SELECT to_jsonb(u) FROM private.roast_charge_usage('{owner}') u").stdout.strip())


command("createdb", "-U", "postgres", database)
try:
    setup = (root / "supabase/tests/trial-event-fixture.sql").read_text()
    for filename in ["20260724000001_batch_gate_trial.sql", "20260724000002_readonly_write_block.sql", "20260810000000_readonly_write_block_service_role_exempt.sql"]:
        setup += "\n" + migration(filename)
    guard = migration("20261015140000_profiles_simulator_enabled.sql")
    setup += "\n" + guard[guard.index("create or replace function"):]
    setup += "\nCREATE TRIGGER protect_billing BEFORE INSERT OR UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION protect_profiles_billing_columns();"
    setup += "\n" + migration("20261020133500_polar_org_cutover.sql")
    mcp = migration("20261101051354_mcp_inventory_production_write.sql")
    start = mcp.index("CREATE FUNCTION private.mcp_write(")
    setup += "\n" + mcp[start:mcp.index("END $$;", start) + len("END $$;")]
    setup += "\n" + migration("20261104150333_trial_event_access.sql")
    query(setup)
    for plan, cap in [("trial", 20), ("trial-event", 100), ("pro", 200)]:
        owner = str(uuid.uuid4())
        query(f"INSERT INTO profiles(id,plan) VALUES('{owner}','{plan}'); INSERT INTO roast_sessions(user_id) SELECT '{owner}' FROM generate_series(1,{cap - 1});")
        sessions = [str(uuid.uuid4()) for _ in range(8)]
        outcomes = race(owner, [f"SELECT reserve_roast_charge('{owner}','{session}')" for session in sessions])
        admitted = [session for session, result in zip(sessions, outcomes) if result.returncode == 0]
        assert len(admitted) == 1, [(r.returncode, r.stderr) for r in outcomes]
        assert all(r.returncode == 0 or "batch_cap" in r.stderr for r in outcomes), outcomes
        assert usage(owner)["reserved_batches"] == 1
        session = admitted[0]
        charged = race(owner, [f"SELECT record_roast_charge('{owner}','{session}',clock_timestamp())"] * 8)
        assert all(r.returncode == 0 for r in charged), [r.stderr for r in charged]
        assert usage(owner)["used_batches"] == cap
        assert usage(owner)["reserved_batches"] == 0
        saved = race(owner, [f"INSERT INTO roast_sessions(id,user_id) VALUES('{session}','{owner}') ON CONFLICT DO NOTHING"] * 8)
        assert all(r.returncode == 0 for r in saved), [r.stderr for r in saved]
        assert usage(owner)["used_batches"] == cap
        query(f"DELETE FROM roast_sessions WHERE id='{session}';")
        assert usage(owner)["used_batches"] == cap
        print(f"{plan}: 8 concurrent admissions, duplicate Charges/saves and deletion passed")
    owner, session = str(uuid.uuid4()), str(uuid.uuid4())
    query(f"INSERT INTO profiles(id,plan) VALUES('{owner}','tester')")
    outcomes = race(owner, [f"SELECT record_roast_charge('{owner}','{session}',clock_timestamp())"] * 8)
    assert all(r.returncode == 0 for r in outcomes), [r.stderr for r in outcomes]
    assert usage(owner)["used_batches"] == 1
    print("tester: 8 concurrent unreserved acknowledgements counted once")
finally:
    command("dropdb", "-U", "postgres", database)
