"""Two-session stock_op_receipts races. Usage: python3 supabase/tests/stock_op_receipt_concurrent.py <owner-uuid>"""

import os
import subprocess
import sys
import time

owner = sys.argv[1]
pgurl = os.environ.get('STOCK_PSQL_URL', 'postgresql://postgres:postgres@127.0.0.1:5433/fc_test')
ref_same = '89200000-0000-0000-0000-000000000040'
ref_mismatch = '89200000-0000-0000-0000-000000000041'
hash_a = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
hash_b = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'


def psql(sql: str, *, stop: bool = True) -> subprocess.CompletedProcess:
    args = ['psql', pgurl]
    if stop:
        args.append('-v')
        args.append('ON_ERROR_STOP=1')
    args.extend(['-c', sql])
    return subprocess.run(args, text=True, capture_output=True, timeout=30)


def assert_ok(result: subprocess.CompletedProcess, label: str) -> None:
    assert result.returncode == 0, (label, result.stdout, result.stderr)


def auth_block() -> str:
    return (
        f"SELECT set_config('request.jwt.claim.sub', '{owner}', true); "
        f"SELECT set_config('request.jwt.claim.role', 'authenticated', true); "
        "SET LOCAL ROLE authenticated; "
    )


# --- same payload concurrent insert ---
psql(f"DELETE FROM stock_op_receipts WHERE reference_id = '{ref_same}'")

worker = subprocess.Popen(
    [
        'psql',
        pgurl,
        '-c',
        f"BEGIN; {auth_block()} "
        f"SELECT public.assert_stock_op_receipt('{ref_same}'::uuid, '{owner}'::uuid, 'bean_event', '{hash_a}'); "
        "SELECT pg_sleep(2); COMMIT;",
    ],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)
time.sleep(0.3)
second = psql(
    f"BEGIN; {auth_block()} "
    f"SELECT public.assert_stock_op_receipt('{ref_same}'::uuid, '{owner}'::uuid, 'bean_event', '{hash_a}'); COMMIT;"
)
worker_out = worker.communicate(timeout=30)[0]
worker_rc = worker.returncode
assert_ok(second, 'same_payload_race_second')
assert worker_rc == 0, ('same_payload_race_first', worker_out)
count = psql(f"SELECT count(*)::text AS c FROM stock_op_receipts WHERE reference_id = '{ref_same}'")
assert '1' in count.stdout and count.returncode == 0, count.stdout

# --- different payload concurrent race ---
psql(f"DELETE FROM stock_op_receipts WHERE reference_id = '{ref_mismatch}'")

first_worker = subprocess.Popen(
    [
        'psql',
        pgurl,
        '-c',
        f"BEGIN; {auth_block()} "
        f"SELECT public.assert_stock_op_receipt('{ref_mismatch}'::uuid, '{owner}'::uuid, 'bean_event', '{hash_a}'); "
        "SELECT pg_sleep(2); COMMIT;",
    ],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)
time.sleep(0.3)
second_bad = psql(
    f"BEGIN; {auth_block()} "
    f"SELECT public.assert_stock_op_receipt('{ref_mismatch}'::uuid, '{owner}'::uuid, 'bean_event', '{hash_b}'); COMMIT;",
    stop=False,
)
first_out = first_worker.communicate(timeout=30)[0]
assert first_worker.returncode == 0, ('mismatch_race_first', first_out)
assert second_bad.returncode != 0 and 'idempotency_payload_mismatch' in (second_bad.stdout + second_bad.stderr), (
    'mismatch_race_second',
    second_bad.stdout,
    second_bad.stderr,
)
count_m = psql(f"SELECT count(*)::text AS c FROM stock_op_receipts WHERE reference_id = '{ref_mismatch}'")
assert '1' in count_m.stdout, count_m.stdout

psql(f"DELETE FROM stock_op_receipts WHERE reference_id IN ('{ref_same}', '{ref_mismatch}')")
print('stock_op_receipt_concurrent ok')
