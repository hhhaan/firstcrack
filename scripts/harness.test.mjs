import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkMigrationRls } from './check-migration-rls.mjs';
import { releaseCiStatus } from './check-release-ci.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file) => readFileSync(join(root, file), 'utf8');

// Exercise the actual workflow shell blocks, with git/curl replaced in a temporary directory.
function runBlock(name) {
    const lines = read('.github/workflows/deploy-edge-functions.yml').split('\n');
    const start = lines.findIndex((line) => line.includes(`- name: ${name}`));
    assert.ok(start >= 0, name);
    const run = lines.findIndex((line, index) => index > start && line.trim() === 'run: |');
    assert.ok(run >= 0, name);
    const body = [];
    for (const line of lines.slice(run + 1)) {
        if (line.trim() && !line.startsWith('          ')) break;
        body.push(line.slice(10));
    }
    return body.join('\n');
}

function workspace(t) {
    const cwd = mkdtempSync(join(tmpdir(), 'fc-harness-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const bin = join(cwd, 'bin');
    mkdirSync(bin);
    return {
        cwd,
        env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` },
        mock(name, script) {
            writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
        },
    };
}

test('RLS requires activation for each permanent table, not policy text', () => {
    const valid = [
        'CREATE TABLE t(id int); ALTER TABLE t ENABLE ROW LEVEL SECURITY;',
        'CrEaTe UNLOGGED TABLE IF NOT EXISTS public.t(id int); ALTER TABLE ONLY public.t\nENABLE ROW LEVEL SECURITY;',
        'CREATE TABLE "public"."Order.Items"(id int); ALTER TABLE "public"."Order.Items" ENABLE ROW LEVEL SECURITY;',
        'CREATE TABLE "a""b"(id int); ALTER TABLE "a""b" ENABLE ROW LEVEL SECURITY;',
        'CREATE TEMP TABLE t ON COMMIT DROP AS SELECT 1;',
        'CREATE TEMPORARY TABLE t(id int);',
        '/* nested /* CREATE TABLE bad(id int); */ still a comment */ -- CREATE TABLE bad(id int);\nSELECT 1;',
        "SELECT 'CREATE TABLE fake(id int);', $$CREATE TABLE fake(id int);$$, $body$CREATE TABLE fake(id int);$body$;",
    ];
    for (const sql of valid) assert.deepEqual(checkMigrationRls(sql), [], sql);
    const invalid = [
        'CREATE TABLE t(id int);',
        'CREATE TABLE t(id int); CREATE POLICY p ON t USING (false);',
        'CREATE TABLE a(id int); CREATE TABLE b(id int); ALTER TABLE a ENABLE ROW LEVEL SECURITY;',
        'CREATE TABLE t(id int); ALTER TABLE other.t ENABLE ROW LEVEL SECURITY;',
        'CREATE TABLE "T"(id int); ALTER TABLE t ENABLE ROW LEVEL SECURITY;',
        'CREATE TABLE t(id int); /* ALTER TABLE t ENABLE ROW LEVEL SECURITY; */',
        "CREATE TABLE t(id int); SELECT 'ALTER TABLE t ENABLE ROW LEVEL SECURITY;';",
        "CREATE TABLE t(id int); SELECT E'escaped\\' ALTER TABLE t ENABLE ROW LEVEL SECURITY;';",
        'CREATE TABLE t(id int); DO $$BEGIN ALTER TABLE t ENABLE ROW LEVEL SECURITY; END$$;',
        'CREATE TABLE t(id int); ALTER TABLE t ENABLE ROW LEVEL SECURITY; ALTER TABLE t DISABLE ROW LEVEL SECURITY;',
    ];
    for (const sql of invalid) assert.ok(checkMigrationRls(sql).length > 0, sql);
    for (const sql of [
        'CREATE TABLE ();',
        'CREATE TABLE db.public.t(id int);',
        'CREATE TABLE t UNKNOWN;',
        '/* unfinished',
        "SELECT 'unfinished",
        'DO $$unfinished',
    ]) {
        assert.throws(() => checkMigrationRls(sql), undefined, sql);
    }
});

test('RLS CLI reports the offending migration and fails', (t) => {
    const { cwd } = workspace(t);
    writeFileSync(join(cwd, 'fixture.sql'), 'CREATE TABLE t(id int); CREATE POLICY p ON t USING (false);');
    const result = spawnSync(process.execPath, [join(root, 'scripts/check-migration-rls.mjs'), cwd], {
        encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /fixture.sql: Missing ENABLE ROW LEVEL SECURITY/);
});

test('shared changes deploy every consumer, including mixed pushes', (t) => {
    const all = ['alpha', 'beta', 'create-polar-checkout', 'polar-webhook'];
    const billing = ['create-polar-checkout', 'polar-webhook'];
    assert.match(
        read('.github/workflows/deploy-edge-functions.yml'),
        /- name: Resolve changed functions\n(?:(?! {6}- ).*\n)* {8}run: node scripts\/resolve-edge-functions\.mjs/,
    );
    for (const [changes, expected] of [
        ['supabase/functions/_shared/auth.ts', all],
        ['supabase/functions/_shared/auth.ts\nsupabase/functions/alpha/index.ts', all],
        ['supabase/functions/_shared/polar.ts', billing],
        ['supabase/functions/_shared/polar-auth.ts\nsupabase/functions/polar-webhook/index.ts', billing],
        ['supabase/functions/create-polar-checkout/index.ts\nsupabase/functions/_shared/polar.test.ts', billing],
        ['supabase/functions/_shared/polar.ts\nsupabase/functions/alpha/index.ts', ['alpha', ...billing]],
        ['supabase/functions/_shared/polar.ts\nsupabase/functions/_shared/auth.ts', all],
        ['supabase/functions/alpha/index.ts', ['alpha']],
        ['', []],
    ]) {
        const { cwd } = workspace(t);
        const env = {
            ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
        };
        const git = (...args) => {
            const result = spawnSync(
                '/usr/bin/git',
                [
                    '-c',
                    'user.name=Harness Test',
                    '-c',
                    'user.email=harness@example.invalid',
                    '-c',
                    'commit.gpgsign=false',
                    '-c',
                    'core.hooksPath=/dev/null',
                    ...args,
                ],
                { cwd, env, encoding: 'utf8' },
            );
            assert.equal(result.status, 0, result.stderr);
            return result.stdout.trim();
        };
        git('init');
        for (const name of ['_shared', ...all]) {
            mkdirSync(join(cwd, 'supabase/functions', name), { recursive: true });
            writeFileSync(join(cwd, 'supabase/functions', name, 'index.ts'), '// baseline\n');
        }
        git('add', 'supabase/functions');
        git('commit', '-m', 'Baseline functions');
        const before = git('rev-parse', 'HEAD');
        for (const file of changes.split('\n').filter(Boolean)) writeFileSync(join(cwd, file), '// changed\n');
        git('add', 'supabase/functions');
        git('commit', '--allow-empty', '-m', 'Fixture push');
        const output = join(cwd, 'output');
        writeFileSync(output, '');
        const result = spawnSync(process.execPath, [join(root, 'scripts/resolve-edge-functions.mjs')], {
            cwd,
            env: {
                ...env,
                FUNCTION_INPUT: '',
                EVENT_NAME: 'push',
                BEFORE_SHA: before,
                GITHUB_OUTPUT: output,
            },
            encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
        const contents = readFileSync(output, 'utf8');
        assert.match(contents, /^functions=(.*)$/m, changes);
        assert.deepEqual(JSON.parse(contents.match(/^functions=(.*)$/m)[1]), expected, changes);
    }
});

test('deployment probes reject transport errors, 5xx and boot errors', (t) => {
    const { cwd, env, mock } = workspace(t);
    mock('sleep', 'exit 0');
    mock('curl', 'printf "%s" "$BODY" > body.txt\nprintf "%s" "$HTTP_CODE"\nexit "$CURL_EXIT"');
    for (const [code, exit, body, expected] of [
        ['200', '0', '{}', 0],
        ['400', '0', '{}', 0],
        ['401', '0', '{}', 0],
        ['403', '0', '{}', 0],
        ['500', '0', '{}', 1],
        ['503', '0', '{}', 1],
        ['200', '0', '{"code":"BOOT_ERROR"}', 1],
        ['000', '7', '', 1],
        ['000', '28', '', 1],
        ['000', '0', '', 1],
    ]) {
        const result = spawnSync('bash', ['-e', '-c', runBlock('Probe deployed functions')], {
            cwd,
            env: {
                ...env,
                FUNCTIONS_JSON: '["alpha"]',
                SUPABASE_URL: 'https://fixture.invalid',
                ANON_KEY: 'fixture',
                HTTP_CODE: code,
                CURL_EXIT: exit,
                BODY: body,
            },
            encoding: 'utf8',
        });
        assert.equal(result.status, expected, `${code}/${exit}: ${result.stdout}\n${result.stderr}`);
    }
    // A successful curl that writes no body must not inherit a previous BOOT_ERROR response.
    writeFileSync(join(cwd, 'body.txt'), 'BOOT_ERROR');
    mock('curl', 'printf 204');
    const result = spawnSync('bash', ['-e', '-c', runBlock('Probe deployed functions')], {
        cwd,
        env: { ...env, FUNCTIONS_JSON: '["alpha"]', SUPABASE_URL: 'https://fixture.invalid', ANON_KEY: 'fixture' },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout);
});

test('release policy fails closed and is shared by CLI, local release and workflow', (t) => {
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
    const cases = [
        [green, 'ok'],
        [[], 'empty'],
        [green.slice(1), 'pending'],
        [green.filter((run) => run.name !== 'native-tests (windows-latest)'), 'pending'],
        [
            green.map((run) =>
                run.name === 'native-tests (macos-15-intel)' ? { ...run, conclusion: 'failure' } : run,
            ),
            'failed',
        ],
        [[...green, { name: 'ios-check', status: 'completed', conclusion: 'skipped' }], 'ok'],
        [[...green, { name: 'paths', status: 'completed', conclusion: 'skipped' }], 'ok'],
    ];
    for (const conclusion of [
        'skipped',
        'action_required',
        'neutral',
        'failure',
        'cancelled',
        'timed_out',
        'stale',
        'unknown',
        null,
    ]) {
        cases.push([[{ ...green[0], conclusion }, ...green.slice(1)], 'failed']);
    }
    for (const status of ['queued', 'in_progress']) {
        cases.push([[{ ...green[0], status, conclusion: null }, ...green.slice(1)], 'pending']);
    }
    cases.push([[...green, { name: 'ios-check', status: 'completed', conclusion: 'failure' }], 'failed']);
    const { cwd, env, mock } = workspace(t);
    mkdirSync(join(cwd, 'scripts'));
    for (const file of ['release.mjs', 'check-release-ci.mjs'])
        writeFileSync(join(cwd, 'scripts', file), read(`scripts/${file}`));
    writeFileSync(join(cwd, 'package.json'), '{"version":"1.0.0"}');
    writeFileSync(join(cwd, 'scripts/version-bump.mjs'), 'process.stdout.write("BUMP_REACHED"); process.exit(42);');
    mock('git', 'if [ "$1" = rev-parse ]; then printf fixture; fi');
    mock('gh', 'printf "%s" "$CHECK_RUNS"');
    assert.match(read('.github/workflows/release.yml'), /node scripts\/check-release-ci\.mjs/);
    const ci = read('.github/workflows/ci.yml');
    const checkJob = ci.slice(ci.indexOf('\n  check:'), ci.indexOf('\n  test:'));
    assert.match(checkJob, /pnpm check:architecture/);
    assert.match(checkJob, /pnpm check:bundle/);
    for (const name of checks) assert.match(ci, new RegExp(`\\n  ${name.split(' (')[0]}:`));
    assert.doesNotMatch(ci, /\n {2}architecture:/);
    assert.doesNotMatch(ci, /\n {2}bundle:/);
    for (const [runs, expected] of cases) {
        assert.equal(releaseCiStatus(runs), expected);
        const cli = spawnSync(process.execPath, [join(root, 'scripts/check-release-ci.mjs')], {
            input: JSON.stringify(runs),
            encoding: 'utf8',
        });
        assert.equal(cli.status, 0, cli.stderr);
        assert.equal(cli.stdout.trim(), expected);
        const local = spawnSync(process.execPath, ['scripts/release.mjs', 'patch'], {
            cwd,
            env: { ...env, CHECK_RUNS: JSON.stringify(runs) },
            encoding: 'utf8',
        });
        assert.equal(local.stdout.includes('BUMP_REACHED'), expected === 'ok', local.stderr);
    }
});
