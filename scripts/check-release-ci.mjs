import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// CI check-run names include matrix suffixes; release preflight and tag gates share this policy.
const required = [
    'check',
    'test',
    'sidecar',
    'semgrep',
    'gitleaks',
    'edge-check',
    'actionlint',
    'zizmor',
    // TEMPORARY, revert after #1018 is fixed: clippy is ignorable (slow Ubuntu apt in CI).
    'native-tests (macos-latest)',
    'native-tests (macos-15-intel)',
    'native-tests (windows-latest)',
];
const optional = ['paths', 'ios-check'];

const PENDING_STATUS = ['queued', 'in_progress', 'waiting', 'pending', 'requested'];

function isPending(run) {
    return PENDING_STATUS.includes(run.status) && run.conclusion == null;
}

// One name can have a PR skip and a main success on the same SHA.
// Skipped alone is not success. A failure still fails when another run was skipped.
function verdictFor(name, runs) {
    if (!runs.length) return 'missing';
    const failed = runs.some((run) => !isPending(run) && run.conclusion !== 'success' && run.conclusion !== 'skipped');
    if (failed) return 'failed';
    if (runs.some(isPending)) return 'pending';
    if (runs.some((run) => run.conclusion === 'success')) return 'ok';
    return optional.includes(name) ? 'ok' : 'failed';
}

export function releaseCiStatus(checkRuns) {
    const runs = checkRuns.filter((run) => required.includes(run.name) || optional.includes(run.name));
    if (!runs.length) return 'empty';
    const verdicts = [
        ...required.map((name) =>
            verdictFor(
                name,
                runs.filter((run) => run.name === name),
            ),
        ),
        ...optional
            .filter((name) => runs.some((run) => run.name === name))
            .map((name) =>
                verdictFor(
                    name,
                    runs.filter((run) => run.name === name),
                ),
            ),
    ];
    if (verdicts.includes('failed')) return 'failed';
    if (verdicts.includes('missing') || verdicts.includes('pending')) return 'pending';
    return 'ok';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    process.stdout.write(`${releaseCiStatus(JSON.parse(readFileSync(0, 'utf8')))}\n`);
}
