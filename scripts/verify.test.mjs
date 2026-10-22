import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { test } from 'node:test';

import { planPush, runVerification, verificationCommands } from './verify.mjs';

const ZERO = '0'.repeat(40);
const gitExecutable = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(isAbsolute)
    .map((directory) => join(directory, process.platform === 'win32' ? 'git.exe' : 'git'))
    .find(existsSync);
assert.ok(gitExecutable, 'Git must be available for integration fixtures');
process.env.VERIFY_GIT_EXECUTABLE = gitExecutable;
for (const key of execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).trim().split('\n')) {
    delete process.env[key];
}

function repo(t) {
    const cwd = mkdtempSync(join(tmpdir(), 'fc-verify-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const git = (...args) =>
        execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Verification fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.hooksPath', join(cwd, '.git', 'hooks-disabled'));
    const write = (path, text = 'export const value = 1;\n') => {
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), text);
    };
    const commit = () => {
        git('add', '.');
        git('commit', '-qm', 'fixture');
        return git('rev-parse', 'HEAD');
    };
    write('README.md', 'fixture\n');
    const base = commit();
    return {
        cwd,
        git,
        write,
        commit,
        base,
        input: (head, remote = base) => `refs/heads/topic ${head} refs/heads/topic ${remote}\n`,
    };
}

test('package-script PATH entries cannot replace pinned Git; missing or relative pins run every check', (t) => {
    const r = repo(t);
    r.write('src/features/example/a.ts');
    const head = r.commit();
    const shadow = mkdtempSync(join(tmpdir(), 'fc-verify-shadow-'));
    const originalPath = process.env.PATH;
    t.after(() => {
        process.env.PATH = originalPath;
        process.env.VERIFY_GIT_EXECUTABLE = gitExecutable;
        rmSync(shadow, { recursive: true, force: true });
    });
    writeFileSync(join(shadow, process.platform === 'win32' ? 'git.exe' : 'git'), 'exit 99\n', { mode: 0o755 });
    process.env.PATH = `${shadow}${delimiter}${originalPath ?? ''}`;
    assert.equal(planPush(r.input(head), r.cwd).base, r.base);
    for (const pin of ['', 'git']) {
        process.env.VERIFY_GIT_EXECUTABLE = pin;
        assert.deepEqual(planPush(r.input(head), r.cwd), { base: null, sidecar: true, actions: true, skip: false });
    }
});

test('an existing branch checks every outgoing commit and uses related tests', (t) => {
    const r = repo(t);
    r.write('src/features/example/a.ts');
    r.commit();
    r.write('src/views/example/b.ts');
    const head = r.commit();
    const plan = planPush(r.input(head), r.cwd);
    assert.deepEqual(plan, { base: r.base, sidecar: false, actions: false, skip: false });
    assert.ok(verificationCommands(plan).includes(`pnpm test --changed=${r.base} --passWithNoTests`));
});

test('sidecar and workflow changes select only their extra checks', (t) => {
    const r = repo(t);
    r.write('src-tauri/sidecar/manager.py', 'value = 1\n');
    const sidecarHead = r.commit();
    const sidecar = planPush(r.input(sidecarHead), r.cwd);
    assert.equal(sidecar.sidecar, true);
    assert.equal(sidecar.actions, false);
    r.write('.github/workflows/release.yml', 'name: fixture\n');
    const workflow = planPush(r.input(r.commit(), sidecarHead), r.cwd);
    assert.equal(workflow.sidecar, false);
    assert.equal(workflow.actions, true);
});

test('shared code, renames and deletions use full tests', (t) => {
    const r = repo(t);
    r.write('src/shared/lib/value.ts');
    const shared = r.commit();
    assert.equal(planPush(r.input(shared), r.cwd).base, null);
    r.write('src/features/example/value.ts');
    const beforeRename = r.commit();
    r.git('mv', 'src/features/example/value.ts', 'src/features/example/renamed.ts');
    const renamed = r.commit();
    assert.equal(planPush(r.input(renamed, beforeRename), r.cwd).base, null);
    r.git('rm', 'src/features/example/renamed.ts');
    assert.equal(planPush(r.input(r.commit(), renamed), r.cwd).base, null);
});

test('new branches, tags, multiple refs, missing commits and dirty trees run all checks', (t) => {
    const r = repo(t);
    r.write('src/features/example/value.ts');
    const head = r.commit();
    const full = { base: null, sidecar: true, actions: true, skip: false };
    for (const input of [
        '',
        'malformed\n',
        r.input(head, ZERO),
        r.input(head, 'a'.repeat(40)),
        r.input(head).replaceAll('refs/heads/', 'refs/tags/'),
        r.input(head) + r.input(head),
        r.input(r.base),
    ]) {
        assert.deepEqual(planPush(input, r.cwd), full, input);
    }
    r.write('untracked.txt', 'dirty\n');
    assert.deepEqual(planPush(r.input(head), r.cwd), full);
    r.git('add', '.');
    assert.deepEqual(planPush(r.input(head), r.cwd), full);
});

test('dependency and runner changes run all checks', (t) => {
    const r = repo(t);
    for (const path of ['package.json', 'pnpm-lock.yaml', 'scripts/verify.mjs', '.husky/pre-push']) {
        r.write(path, 'fixture\n');
        const plan = planPush(r.input(r.commit()), r.cwd);
        assert.equal(plan.base, null);
        assert.equal(plan.sidecar, true);
        assert.equal(plan.actions, true);
    }
});

test('diverged history and paths Git may quote do not narrow tests', (t) => {
    const r = repo(t);
    r.write('src/features/example/value.ts');
    const head = r.commit();
    r.git('checkout', '--detach', r.base);
    r.write('src-tauri/sidecar/manager.py', 'value = 1\n');
    const remote = r.commit();
    r.git('checkout', '--detach', head);
    assert.deepEqual(planPush(r.input(head, remote), r.cwd), {
        base: null,
        sidecar: true,
        actions: true,
        skip: false,
    });
    r.write('src/features/example/with space.ts');
    assert.equal(planPush(r.input(r.commit()), r.cwd).base, null);
});

test('ref deletion does not validate unrelated checkout contents', () => {
    const plan = planPush(`(delete) ${ZERO} refs/heads/topic ${'a'.repeat(40)}\n`);
    assert.deepEqual(verificationCommands(plan), []);
});

test('full and core verification retain their required checks', () => {
    const core = verificationCommands(undefined, true);
    assert.deepEqual(core, ['pnpm check:project', 'pnpm check:harness', 'pnpm knip', 'pnpm typecheck', 'pnpm test']);
    const full = verificationCommands();
    for (const check of [
        ...core,
        'pnpm lint',
        'pnpm check:architecture',
        'pnpm verify:sidecar',
        'pnpm check:actions',
    ]) {
        assert.ok(full.includes(check), check);
    }
});

test('a failed check terminates a running sibling and rejects verification', async () => {
    await assert.rejects(
        runVerification(['node -e "setInterval(() => {}, 1000)"', 'node -e "process.exit(7)"']),
        (events) => events.some((event) => event.killed) && events.some((event) => event.exitCode === 7),
    );
});
