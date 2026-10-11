import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { areasForPaths, detectFromGit, pathsFromNameStatusZ, UNCERTAIN_AREAS } from './ci-changed-areas.mjs';

// Git hooks export repository paths; fixture commands must use their temporary repository.
for (const key of execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).trim().split('\n')) {
    delete process.env[key];
}

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file) => readFileSync(join(root, file), 'utf8');

// Expected PR job selection. Docs-only never reaches these jobs: ci.yml and
// react-doctor.yml share paths-ignore, so the workflow does not start.
// main push always runs clippy, sidecar, and edge-check (changes job is skipped).
const CASES = [
    ['frontend-only', ['src/App.tsx', 'package.json', 'pnpm-lock.yaml'], false, false, false],
    ['rust-only', ['src-tauri/src/lib.rs'], true, false, false],
    ['rust lock', ['src-tauri/Cargo.lock', 'src-tauri/Cargo.toml'], true, false, false],
    [
        'tauri config',
        ['src-tauri/tauri.conf.json', 'src-tauri/binaries/sidecar-aarch64-apple-darwin'],
        true,
        false,
        false,
    ],
    ['sidecar-only', ['src-tauri/sidecar/main.py'], false, true, false],
    ['sidecar deps', ['src-tauri/sidecar/requirements-dev.txt', 'src-tauri/sidecar/pytest.ini'], false, true, false],
    ['sidecar script', ['scripts/verify-sidecar.sh'], false, true, false],
    ['edge-only', ['supabase/functions/notify-signup/index.ts'], false, false, true],
    ['edge shared', ['supabase/functions/_shared/auth.ts'], false, false, true],
    ['deno config', ['deno.json', 'supabase/deno.lock'], false, false, true],
    ['migration-only', ['supabase/migrations/20260101000000_x.sql', 'supabase/config.toml'], false, false, false],
    [
        'docs-only paths',
        ['README.md', 'docs/agent/active-roast-save.md', '.agents/skills/x/SKILL.md'],
        false,
        false,
        false,
    ],
    ['shared workflow', ['.github/workflows/ci.yml'], true, true, true],
    ['classifier script', ['scripts/ci-changed-areas.mjs'], true, true, true],
    ['mixed rust+edge', ['src-tauri/src/lib.rs', 'supabase/functions/order-sync/index.ts'], true, false, true],
    [
        'mixed sidecar+frontend',
        ['src-tauri/sidecar/manager.py', 'src/views/history/ui/HistoryView.tsx'],
        false,
        true,
        false,
    ],
    ['rust toolchain', ['rust-toolchain.toml', '.cargo/config.toml', 'clippy.toml'], true, false, false],
    ['root cargo', ['Cargo.toml', 'Cargo.lock'], true, false, false],
];

test('area selection matches the PR path table', () => {
    for (const [name, paths, clippy, sidecar, edge] of CASES) {
        assert.deepEqual(areasForPaths(paths), { clippy, sidecar, edge }, name);
    }
});

test('rename, delete, and copy keep both paths', () => {
    const renamedOut = pathsFromNameStatusZ('R100\0src-tauri/src/lib.rs\0docs/lib.rs\0');
    assert.deepEqual(areasForPaths(renamedOut), { clippy: true, sidecar: false, edge: false });

    const renamedAcross = pathsFromNameStatusZ('R090\0src-tauri/sidecar/main.py\0src-tauri/src/main.rs\0');
    assert.deepEqual(areasForPaths(renamedAcross), { clippy: true, sidecar: true, edge: false });

    const deleted = pathsFromNameStatusZ('D\0supabase/functions/notify-signup/index.ts\0');
    assert.deepEqual(areasForPaths(deleted), { clippy: false, sidecar: false, edge: true });

    const added = pathsFromNameStatusZ('A\0src-tauri/src/new.rs\0');
    assert.deepEqual(areasForPaths(added), { clippy: true, sidecar: false, edge: false });

    const copied = pathsFromNameStatusZ('C100\0src-tauri/src/lib.rs\0src/lib.rs\0');
    assert.deepEqual(areasForPaths(copied), { clippy: true, sidecar: false, edge: false });
});

test('a clean empty diff skips area jobs; a broken diff runs all three', () => {
    assert.deepEqual(areasForPaths(pathsFromNameStatusZ('')), { clippy: false, sidecar: false, edge: false });
    assert.equal(pathsFromNameStatusZ('U\0src/App.tsx\0'), null);
    assert.equal(pathsFromNameStatusZ('R100\0only-old\0'), null);
    assert.equal(pathsFromNameStatusZ('Z\0src/App.tsx\0'), null);
    assert.deepEqual(UNCERTAIN_AREAS, { clippy: true, sidecar: true, edge: true });
});

test('git diff failure and a missing base run every area check', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fc-areas-'));
    try {
        const git = (...args) =>
            execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
                cwd,
                env: {
                    ...process.env,
                    GIT_AUTHOR_NAME: 't',
                    GIT_AUTHOR_EMAIL: 't@example.com',
                    GIT_COMMITTER_NAME: 't',
                    GIT_COMMITTER_EMAIL: 't@example.com',
                },
            });
        git('init', '-q');
        writeFileSync(join(cwd, 'src-file.txt'), 'a\n');
        git('add', 'src-file.txt');
        git('commit', '-q', '-m', 'init');
        const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
        writeFileSync(join(cwd, 'src-file.txt'), 'b\n');
        git('commit', '-q', '-am', 'edit');
        const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();

        assert.deepEqual(detectFromGit(base, head, cwd), { clippy: false, sidecar: false, edge: false });
        assert.deepEqual(detectFromGit('', head, cwd), UNCERTAIN_AREAS);
        assert.deepEqual(detectFromGit('0'.repeat(40), head, cwd), UNCERTAIN_AREAS);
        assert.deepEqual(detectFromGit('deadbeef', head, cwd), UNCERTAIN_AREAS);

        writeFileSync(join(cwd, 'src-tauri-note.rs'), 'x\n');
        git('add', 'src-tauri-note.rs');
        git('commit', '-q', '-m', 'not rust');
        const note = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
        assert.deepEqual(detectFromGit(head, note, cwd), { clippy: false, sidecar: false, edge: false });

        mkdirSync(join(cwd, 'src-tauri/src'), { recursive: true });
        git('mv', 'src-file.txt', 'src-tauri/src/lib.rs');
        git('commit', '-q', '-m', 'rename into rust');
        const renamed = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
        assert.deepEqual(detectFromGit(note, renamed, cwd), { clippy: true, sidecar: false, edge: false });
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});

function skipDocsList(yaml) {
    const lines = yaml.split('\n');
    const start = lines.findIndex((line) => line.includes('paths-ignore: &skip-docs'));
    assert.ok(start >= 0);
    const items = [];
    for (const line of lines.slice(start + 1)) {
        const match = line.match(/^\s+- (.+)$/);
        if (!match) break;
        items.push(match[1]);
    }
    assert.ok(items.length > 0);
    return items;
}

test('React Doctor docs-only ignore matches CI', () => {
    assert.deepEqual(
        skipDocsList(read('.github/workflows/react-doctor.yml')),
        skipDocsList(read('.github/workflows/ci.yml')),
    );
});

test('PR area jobs fail open and main push does not depend on a successful filter', () => {
    const ci = read('.github/workflows/ci.yml');
    assert.match(ci, /changes:[\s\S]*if: github\.event_name == 'pull_request'/);
    assert.match(ci, /node scripts\/ci-changed-areas\.mjs/);
    for (const [job, output] of [
        ['clippy', 'clippy'],
        ['native-tests', 'clippy'],
        ['sidecar', 'sidecar'],
        ['edge-check', 'edge'],
    ]) {
        const block = ci.slice(ci.indexOf(`\n  ${job}:`));
        assert.match(
            block,
            new RegExp(
                `${job}:[\\s\\S]*?if: "\\$\\{\\{ !cancelled\\(\\) && \\(needs\\.changes\\.result != 'success' \\|\\| needs\\.changes\\.outputs\\.${output} == 'true'\\) \\}\\}"`,
            ),
        );
    }
});

test('a skipped required check does not satisfy the release gate unless a success run exists', async () => {
    const { releaseCiStatus } = await import('./check-release-ci.mjs');
    const checks = [
        'check',
        'test',
        'sidecar',
        'semgrep',
        'gitleaks',
        'edge-check',
        'actionlint',
        'zizmor',
        'clippy',
        'native-tests (macos-latest)',
        'native-tests (macos-15-intel)',
        'native-tests (windows-latest)',
    ];
    const green = checks.map((name) => ({ name, status: 'completed', conclusion: 'success' }));
    const withClippy = (extra) =>
        green.map((run) => (run.name === 'clippy' ? extra : run)).concat(extra.name === 'clippy' ? [] : []);
    assert.equal(releaseCiStatus([...green, { name: 'clippy', status: 'completed', conclusion: 'skipped' }]), 'ok');
    assert.equal(releaseCiStatus(withClippy({ name: 'clippy', status: 'completed', conclusion: 'skipped' })), 'failed');
    assert.equal(
        releaseCiStatus([
            ...green.filter((run) => run.name !== 'clippy'),
            { name: 'clippy', status: 'completed', conclusion: 'failure' },
            { name: 'clippy', status: 'completed', conclusion: 'skipped' },
        ]),
        'failed',
    );
    assert.equal(
        releaseCiStatus([
            ...green.filter((run) => run.name !== 'clippy'),
            { name: 'clippy', status: 'completed', conclusion: 'success' },
            { name: 'clippy', status: 'completed', conclusion: 'failure' },
        ]),
        'failed',
    );
});
