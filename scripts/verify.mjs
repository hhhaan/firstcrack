import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import concurrently from 'concurrently';

import { areasForPaths, pathsFromNameStatusZ } from './ci-changed-areas.mjs';

const FULL_PLAN = { base: null, sidecar: true, actions: true, skip: false };
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const ZERO_SHA = /^0+$/;

export function planPush(input, cwd = process.cwd()) {
    const records = input
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/\s+/));
    if (records.some((row) => row.length !== 4 || !SHA.test(row[1]) || !SHA.test(row[3]))) {
        return { ...FULL_PLAN };
    }
    const updates = records.filter((row) => !ZERO_SHA.test(row[1]));
    if (updates.length === 0) return { ...FULL_PLAN, skip: true };
    if (updates.length !== 1) return { ...FULL_PLAN };
    const [localRef, head, remoteRef, base] = updates[0];
    if (!localRef.startsWith('refs/heads/') || !remoteRef.startsWith('refs/heads/') || ZERO_SHA.test(base)) {
        return { ...FULL_PLAN };
    }

    const git = (args) =>
        execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    try {
        // Validators inspect the checkout; only narrow a push that matches its clean tree.
        if (git(['rev-parse', 'HEAD']).trim() !== head || git(['status', '--porcelain', '-z'])) {
            return { ...FULL_PLAN };
        }
        // Vitest --changed uses a merge-base diff; diverged pushes need the full suite.
        git(['merge-base', '--is-ancestor', base, head]);
        const diff = git(['diff', '--name-status', '--find-renames', '-z', base, head]);
        const paths = pathsFromNameStatusZ(diff);
        if (!paths) return { ...FULL_PLAN };
        if (
            paths.some(
                (path) =>
                    (!path.includes('/') && !path.endsWith('.md')) ||
                    path.startsWith('.husky/') ||
                    path.startsWith('scripts/verify') ||
                    path === 'scripts/ci-changed-areas.mjs',
            )
        ) {
            return { ...FULL_PLAN };
        }
        // shortcut: related tests follow imports, so shared/config changes and removals run the full suite.
        const related =
            paths.length > 0 &&
            paths.every((path) => /^src\/(entities|features|widgets|views)\/[\w./-]+$/.test(path)) &&
            !/(?:^|\0)(?:D|R\d+)\0/.test(diff);
        return {
            base: related ? base : null,
            sidecar: areasForPaths(paths).sidecar,
            actions: paths.some(
                (path) =>
                    path.startsWith('.github/') ||
                    path === 'scripts/check-actions.mjs' ||
                    path === 'scripts/pinned-tool.mjs',
            ),
            skip: false,
        };
    } catch {
        return { ...FULL_PLAN };
    }
}

export function verificationCommands(plan = FULL_PLAN, coreOnly = false) {
    if (plan.skip) return [];
    const commands = [
        'pnpm check:project',
        'pnpm check:harness',
        'pnpm knip',
        'pnpm typecheck',
        plan.base ? `pnpm test --changed=${plan.base} --passWithNoTests` : 'pnpm test',
    ];
    if (!coreOnly) {
        commands.push('pnpm lint', 'pnpm check:architecture');
        if (plan.sidecar) commands.push('pnpm verify:sidecar');
        if (plan.actions) commands.push('pnpm check:actions');
    }
    return commands;
}

export function runVerification(commands) {
    return concurrently(commands, { raw: true, killOthersOn: ['failure'], killTimeout: 3000 }).result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const mode = process.argv[2];
    if (!['--core', '--all', '--push'].includes(mode)) {
        console.error('Usage: node scripts/verify.mjs --core|--all|--push');
        process.exitCode = 1;
    } else {
        const plan = mode === '--push' ? planPush(readFileSync(0, 'utf8')) : FULL_PLAN;
        const commands = verificationCommands(plan, mode === '--core');
        console.log(`verify: ${commands.join(', ') || 'ref deletions only; no checks'}`);
        if (commands.length) {
            try {
                await runVerification(commands);
            } catch {
                process.exitCode = 1;
            }
        }
    }
}
