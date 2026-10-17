"""Two-session stock_op_receipts races. Usage: python3 supabase/tests/stock_op_receipt_concurrent.py <owner-uuid>"""

import os
import subprocess
import sys
import time

owner = sys.argv[1]
pgurl = os.environ.get('STOCK_PSQL_URL', 'postgresql://postgres:postgres@127.0.0.1:5433/fc_test')
ref = '89200000-0000-0000-0000-000000000040'
hash_a = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
hash_b = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'


def psql(sql: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ['psql', pgurl, '-v', 'ON_ERROR_STOP=1', '-c', sql],
        text=True,
        capture_output=True,
        timeout=30,
    )


def assert_ok(result: subprocess.CompletedProcess, label: str) -> None:
    assert result.returncode == 0, (label, result.stdout, result.stderr)


def auth_block() -> str:
    return (
        f"SELECT set_config('request.jwt.claim.sub', '{owner}', true); "
        f"SELECT set_config('request.jwt.claim.role', 'authenticated', true); "
        "SET LOCAL ROLE authenticated; "
    )


psql(f"DELETE FROM stock_op_receipts WHERE reference_id = '{ref}'")

worker = subprocess.Popen(
    [
        'psql',
        pgurl,
        '-c',
        f"BEGIN; {auth_block()} "
        f"SELECT public.assert_stock_op_receipt('{ref}'::uuid, '{owner}'::uuid, 'bean_event', '{hash_a}'); "
        "SELECT pg_sleep(2); COMMIT;",
    ],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)
time.sleep(0.3)
second = psql(
    f"BEGIN; {auth_block()} "
    f"SELECT public.assert_stock_op_receipt('{ref}'::uuid, '{owner}'::uuid, 'bean_event', '{hash_a}'); COMMIT;"
)
worker.wait(timeout=30)
assert_ok(second, 'same_payload_race')
count = psql(f"SELECT count(*)::text AS c FROM stock_op_receipts WHERE reference_id = '{ref}'")
assert '1' in count.stdout and count.returncode == 0, count.stdout

psql(f"DELETE FROM stock_op_receipts WHERE reference_id = '{ref}'")
assert_ok(
    psql(
        f"BEGIN; {auth_block()} "
        f"SELECT public.assert_stock_op_receipt('{ref}'::uuid, '{owner}'::uuid, 'bean_event', '{hash_a}'); COMMIT;"
    ),
    'seed_receipt',
)
bad = psql(
    f"BEGIN; {auth_block()} "
    f"SELECT public.assert_stock_op_receipt('{ref}'::uuid, '{owner}'::uuid, 'bean_event', '{hash_b}'); COMMIT;"
)
assert bad.returncode != 0 and 'idempotency_payload_mismatch' in (bad.stdout + bad.stderr), (
    'mismatch_payload',
    bad.stdout,
    bad.stderr,
)

psql(f"DELETE FROM stock_op_receipts WHERE reference_id = '{ref}'")
print('stock_op_receipt_concurrent ok')
