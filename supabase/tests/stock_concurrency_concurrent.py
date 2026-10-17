"""Two-connection stock concurrency tests. Usage: python3 supabase/tests/stock_concurrency_concurrent.py <owner-uuid>"""

import os
import pathlib
import subprocess
import sys

fixture = pathlib.Path(__file__).with_name('stock_concurrency.sql').read_text()
owner = sys.argv[1]
pgurl = os.environ.get('STOCK_PSQL_URL', 'postgresql://postgres:postgres@127.0.0.1:5433/fc_test')
base = ['psql', pgurl, '-v', f'owner={owner}']


def run_psql(extra_vars: dict, *, stop: bool = True, input_text: str | None = None, tuples_only: bool = False) -> subprocess.CompletedProcess:
    args = base + (['-v', 'ON_ERROR_STOP=1'] if stop else [])
    if tuples_only:
        args.extend(['-t', '-A'])
    for key, value in extra_vars.items():
        args.extend(['-v', f'{key}={value}'])
    args.extend(['-f', str(pathlib.Path(__file__).with_name('stock_concurrency.sql'))])
    return subprocess.run(args, input=input_text, text=True, capture_output=True, timeout=30)


def assert_verify(scenario: str, extra: dict, expected_lines: list[str]) -> None:
    result = run_psql({'verify': 1, **extra}, tuples_only=True)
    assert result.returncode == 0, (scenario, result.stdout, result.stderr)
    lines = [line for line in result.stdout.strip().splitlines() if line]
    assert lines == expected_lines, (scenario, lines, result.stdout)


def run_race(scenario: str, setup_flags: dict, first_flags: dict, second_flags: dict, verify_flags: dict, verify_checks: list[str]) -> None:
    run_psql({'teardown': 1}, stop=True)
    run_psql(setup_flags, stop=True)
    worker = subprocess.Popen(
        base + ['-v', 'ON_ERROR_STOP=1'] + [arg for k, v in {**first_flags}.items() for arg in ('-v', f'{k}={v}')]
        + ['-f', str(pathlib.Path(__file__).with_name('stock_concurrency.sql'))],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    worker.stdin.write(fixture)
    worker.stdin.close()
    for line in worker.stdout:
        if line.strip() == 'ready':
            break
    else:
        raise AssertionError(f'{scenario}: first writer failed: {worker.wait()}')
    assert worker.poll() is None, f'{scenario}: first transaction already ended'
    second = run_psql(second_flags, stop=False)
    remaining = worker.stdout.read()
    assert worker.wait(timeout=30) == 0, (scenario, remaining)
    if second.returncode != 0 and 'insufficient' not in (second.stdout + second.stderr):
        raise AssertionError((scenario, second.stdout, second.stderr))
    assert_verify(scenario, verify_flags, verify_checks)
    print(f'{scenario}: passed')


for scenario, setup_flags, first_flags, second_flags, verify_flags, verify_checks in [
    (
        'fulfill_race',
        {'setup': 1, 'fulfill_race': 1},
        {'call': 1, 'fulfill_a': 1, 'hold': 1},
        {'call': 1, 'fulfill_b': 1},
        {'verify': 1, 'fulfill_race': 1},
        ['1', '1'],
    ),
    (
        'pack_race',
        {'setup': 1, 'pack_race': 1},
        {'call': 1, 'pack_a': 1, 'hold': 1},
        {'call': 1, 'pack_b': 1},
        {'verify': 1, 'pack_race': 1},
        ['250'],
    ),
    (
        'session_then_complete',
        {'setup': 1, 'roast_race': 1},
        {'call': 1, 'save_session': 1, 'hold': 1},
        {'call': 1, 'complete_batch': 1},
        {'verify': 1, 'roast_race': 1},
        ['-3000', 'done'],
    ),
    (
        'complete_then_session',
        {'setup': 1, 'roast_race': 1},
        {'call': 1, 'complete_batch': 1, 'hold': 1},
        {'call': 1, 'save_session': 1},
        {'verify': 1, 'roast_race': 1},
        ['-3000', 'done'],
    ),
    (
        'legacy_client_race',
        {'setup': 1, 'old_client': 1},
        {'call': 1, 'legacy_complete': 1, 'hold': 1},
        {'call': 1, 'legacy_complete': 1},
        {'verify': 1, 'old_client': 1},
        ['-2000', '1640'],
    ),
    (
        'ef_batch_race',
        {'setup': 1, 'ef_batch_race': 1},
        {'call': 1, 'ef_batch_a': 1, 'hold': 1},
        {'call': 1, 'ef_batch_b': 1},
        {'verify': 1, 'ef_batch_race': 1},
        ['1', '1'],
    ),
    (
        'fulfill_ef_race',
        {'setup': 1, 'fulfill_ef_race': 1},
        {'call': 1, 'fulfill_mix': 1, 'hold': 1},
        {'call': 1, 'ef_batch_mix': 1},
        {'verify': 1, 'fulfill_ef_race': 1},
        ['1', '1'],
    ),
]:
    run_race(scenario, setup_flags, first_flags, second_flags, verify_flags, verify_checks)

# recurrence_rule_id must not change between observe and batch lock (SQLSTATE 40001)
run_psql({'teardown': 1})
run_psql({'setup': 1, 'recurrence_40001': 1})
worker = subprocess.Popen(
    base + ['-v', 'ON_ERROR_STOP=1', '-v', 'call=1', '-v', 'recurrence_hold=1', '-v', 'hold=1']
    + ['-f', str(pathlib.Path(__file__).with_name('stock_concurrency.sql'))],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
)
worker.stdin.write(fixture)
worker.stdin.close()
for line in worker.stdout:
    if line.strip() == 'ready':
        break
else:
    raise AssertionError(f'recurrence_40001: hold writer failed: {worker.wait()}')
second = run_psql({'call': 1, 'lock_batch_write': 1}, stop=False)
remaining = worker.stdout.read()
assert worker.wait(timeout=30) == 0, ('recurrence_40001', remaining)
assert 'plan recurrence changed' in (second.stdout + second.stderr), ('recurrence_40001', second.stdout, second.stderr)
print('recurrence_40001: passed')

# Single-connection checks
run_psql({'teardown': 1})
clamp = run_psql({'call': 1, 'clamp_twice': 1})
assert clamp.returncode == 0, ('clamp_twice_in_tx', clamp.stdout, clamp.stderr)
print('clamp_twice_in_tx: passed')

run_psql({'teardown': 1})
run_psql({'setup': 1, 'corrective': 1})
run_psql({'call': 1, 'repair_inbound': 1})
assert_verify('corrective_inbound', {'verify': 1, 'corrective': 1}, ['-2'])

run_psql({'teardown': 1})
run_psql({'setup': 1, 'fulfill_race': 1})
run_psql({'call': 1, 'fulfill_a': 1})
run_psql({'call': 1, 'retry_fulfill': 1})
assert_verify('fulfill_retry', {'verify': 1, 'fulfill_race': 1}, ['1', '1'])

run_psql({'teardown': 1})
run_psql({'setup': 1, 'old_client': 1})
run_psql({'call': 1, 'legacy_complete': 1})
assert_verify('old_client_one_session', {'verify': 1, 'old_client': 1}, ['-2000', '1640'])

run_psql({'teardown': 1})
run_psql({'setup': 1, 'old_client': 1, 'three_sessions': 1})
run_psql({'call': 1, 'legacy_complete': 1})
assert_verify('old_client_three_sessions', {'verify': 1, 'old_client': 1}, ['0', '0'])

run_psql({'teardown': 1})
run_psql({'setup': 1, 'rollback_fail': 1})
bad = run_psql({'call': 1, 'rollback_bad': 1}, stop=False)
assert 'insufficient_product_stock' in (bad.stdout + bad.stderr), ('rollback_fail', bad.stdout, bad.stderr)
assert_verify('rollback_fail', {'verify': 1, 'rollback_fail': 1}, ['2'])

assert_verify('insert_product_stock_events_batch_orders_lock', {'verify': 1, 'orders_lock_def': 1}, ['1'])

print('all stock concurrency tests passed')
