"""Local only: python3 supabase/tests/roast_batch_numbers_concurrency.py <db-container>."""

import json
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor

container = sys.argv[1]
owner = str(uuid.uuid4())
profile = str(uuid.uuid4())
source = str(uuid.uuid4())


def sql(query):
    result = subprocess.run(
        ["docker", "exec", "-i", "-e", "PGPASSWORD=postgres", container,
         "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"],
        input=query, text=True, capture_output=True, check=True,
    )
    return result.stdout


def save(session_id):
    result = sql(f"""
BEGIN;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '{owner}', true);
END $$;
SELECT row_to_json(s) FROM public.save_roast_op(
  '{{"id":"{session_id}","user_id":"{owner}","profile_id":"{profile}",
    "status":"completed","weight_grams":0,"batch_name":"Concurrent"}}'::jsonb,
  false, 0, 0, false) s;
SELECT pg_sleep(0.03);
COMMIT;
""")
    return next(json.loads(line) for line in result.splitlines() if line.startswith("{"))


try:
    sql(f"""
BEGIN;
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created_slack;
INSERT INTO auth.users(id, email) VALUES ('{owner}', '{owner}@example.invalid');
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created_slack;
UPDATE public.profiles SET plan='team' WHERE id='{owner}';
SELECT set_config('request.jwt.claim.sub', '{owner}', true);
INSERT INTO public.roast_sessions(id, user_id, status, weight_grams)
  VALUES ('{source}', '{owner}', 'completed', 0);
INSERT INTO public.roast_profiles(id, user_id, name, target_level, source_session_id)
  VALUES ('{profile}', '{owner}', 'Concurrent profile', 'Medium', '{source}');
COMMIT;
""")
    with ThreadPoolExecutor(max_workers=6) as pool:
        distinct = list(pool.map(save, [str(uuid.uuid4()) for _ in range(6)]))
        assert sorted(row["profile_batch_number"] for row in distinct) == list(range(1, 7))
        assert sorted(row["total_batch_number"] for row in distinct) == list(range(2, 8))
        retry_id = str(uuid.uuid4())
        retries = list(pool.map(save, [retry_id] * 6))
        assert all(row["profile_batch_number"] == 7 and row["total_batch_number"] == 8 for row in retries)
    next_row = save(str(uuid.uuid4()))
    assert next_row["profile_batch_number"] == 8 and next_row["total_batch_number"] == 9
    print("PASS: concurrent saves have unique numbers; concurrent UUID retries allocate once.")
finally:
    sql(f"""
DELETE FROM public.roast_profiles WHERE user_id='{owner}';
DELETE FROM public.roast_sessions WHERE user_id='{owner}';
DELETE FROM auth.users WHERE id='{owner}';
""")
