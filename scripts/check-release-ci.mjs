import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Names are ci.yml job IDs. Both local release preflight and the tag gate use this policy.
const required = [
    'check',
    'test',
    'sidecar',
    'semgrep',
    'gitleaks',
    'edge-check',
    'actionlint',
    'zizmor',
    'architecture',
    'bundle',
];
const optional = ['paths', 'ios-check'];

export function releaseCiStatus(checkRuns) {
    const runs = checkRuns.filter((run) => required.includes(run.name) || optional.includes(run.name));
    if (!runs.length) return 'empty';
    const passed = (run) =>
        run.conclusion === 'success' || (optional.includes(run.name) && run.conclusion === 'skipped');
    const pending = (run) =>
        ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(run.status) && run.conclusion == null;
    if (runs.some((run) => !passed(run) && !pending(run))) return 'failed';
    if (required.some((name) => !runs.some((run) => run.name === name)) || runs.some(pending)) return 'pending';
    return 'ok';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    process.stdout.write(`${releaseCiStatus(JSON.parse(readFileSync(0, 'utf8')))}\n`);
}
