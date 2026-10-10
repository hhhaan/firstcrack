"""Local-only concurrency regression: python3 .../channel_orders_concurrent.py <owner uuid>."""

import pathlib
import subprocess
import sys

fixture = pathlib.Path(__file__).with_suffix('.sql').read_text()
owner = sys.argv[1]
base = ['docker', 'exec', '-i', 'supabase_db_fc-desktop', 'psql', '-U', 'postgres', '-d', 'postgres',
        '-v', 'ON_ERROR_STOP=1', '-v', f'owner={owner}']


def command(**variables):
    return base + [arg for key, value in variables.items() for arg in ['-v', f'{key}={value}']]


for scenario, first_op, second_op in [
    ('sync_fulfill', 'sync', 'fulfill'),
    ('fulfill_sync', 'fulfill', 'sync'),
    ('sync_cancel', 'sync', 'cancel'),
    ('cancel_sync', 'cancel', 'sync'),
    ('retry', 'sync', 'sync'),
    ('new_retry', 'sync', 'sync'),
]:
    subprocess.run(command(setup=1, scenario=scenario), input=fixture, text=True, check=True, capture_output=True)
    worker = subprocess.Popen(command(call=1, op=first_op, hold=1), stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    worker.stdin.write(fixture)
    worker.stdin.close()
    # Start the second writer while the first transaction still holds its locks.
    for line in worker.stdout:
        if line.strip() == 'ready':
            break
    else:
        raise AssertionError(f'{scenario}: first writer failed: {worker.wait()}')
    assert worker.poll() is None, f'{scenario}: first transaction already ended'
    second = subprocess.run(command(call=1, op=second_op), input=fixture, text=True,
                            capture_output=True, timeout=20)
    remaining = worker.stdout.read()
    assert worker.wait(timeout=20) == 0, (scenario, remaining)
    assert second.returncode == 0, (scenario, second.stdout, second.stderr)
    subprocess.run(command(verify=1, scenario=scenario), input=fixture, text=True, check=True, capture_output=True)
    print(f'{scenario}: passed')
