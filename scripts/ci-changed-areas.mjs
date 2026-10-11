import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// PR path filter for clippy, sidecar, and edge-check.
// main push does not run this script. check-release-ci.mjs still requires a
// success run of each of those jobs on the main SHA.
//
// package.json / pnpm-lock.yaml are not inputs: clippy is cargo, sidecar is
// pip + pytest, edge-check uses `deno check --node-modules-dir=none`.
// .github/actions/* are not inputs of those three jobs. .github/workflows/ci.yml
// is, because it defines them.

const ZERO_SHA = '0000000000000000000000000000000000000000';

export const UNCERTAIN_AREAS = { clippy: true, sidecar: true, edge: true };

const AREA_PREFIXES = [
    ['supabase/functions/', 'edge'],
    ['src-tauri/sidecar/', 'sidecar'],
    ['src-tauri/', 'clippy'],
    ['.cargo/', 'clippy'],
];

const AREA_FILES = new Map([
    ['scripts/verify-sidecar.sh', 'sidecar'],
    ['deno.json', 'edge'],
    ['deno.jsonc', 'edge'],
    ['deno.lock', 'edge'],
    ['import_map.json', 'edge'],
    ['supabase/deno.json', 'edge'],
    ['supabase/deno.jsonc', 'edge'],
    ['supabase/deno.lock', 'edge'],
    ['supabase/import_map.json', 'edge'],
    ['rust-toolchain', 'clippy'],
    ['rust-toolchain.toml', 'clippy'],
    ['clippy.toml', 'clippy'],
    ['.clippy.toml', 'clippy'],
    ['Cargo.toml', 'clippy'],
    ['Cargo.lock', 'clippy'],
]);

const SHARED_FILES = new Set(['.github/workflows/ci.yml', 'scripts/ci-changed-areas.mjs']);

export function areaForPath(path) {
    const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
    if (SHARED_FILES.has(normalized)) return 'all';
    const exact = AREA_FILES.get(normalized);
    if (exact) return exact;
    for (const [prefix, area] of AREA_PREFIXES) {
        if (normalized.startsWith(prefix)) return area;
    }
    return null;
}

export function areasForPaths(paths) {
    const areas = { clippy: false, sidecar: false, edge: false };
    for (const path of paths) {
        const area = areaForPath(path);
        if (area === 'all') return { ...UNCERTAIN_AREAS };
        if (area) areas[area] = true;
    }
    return areas;
}

// git diff --name-status --find-renames -z
// Empty string is a complete diff with no file changes. null means the record
// is truncated or not a status we can trust.
export function pathsFromNameStatusZ(text) {
    if (text === '') return [];
    const parts = text.split('\0');
    if (parts.at(-1) === '') parts.pop();
    const paths = [];
    let index = 0;
    while (index < parts.length) {
        const status = parts[index++];
        const code = status?.[0];
        if (!code) return null;
        if (code === 'R' || code === 'C') {
            const from = parts[index++];
            const to = parts[index++];
            if (!from || !to) return null;
            paths.push(from, to);
            continue;
        }
        if (!'AMDT'.includes(code)) return null;
        const file = parts[index++];
        if (!file) return null;
        paths.push(file);
    }
    return paths;
}

export function detectFromGit(base, head, cwd = process.cwd()) {
    if (!base || !head || base === ZERO_SHA || head === ZERO_SHA) return UNCERTAIN_AREAS;
    try {
        execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd, stdio: 'ignore' });
        execFileSync('git', ['cat-file', '-e', `${head}^{commit}`], { cwd, stdio: 'ignore' });
        const diff = execFileSync('git', ['diff', '--name-status', '--find-renames', '-z', base, head], {
            cwd,
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024,
        });
        const paths = pathsFromNameStatusZ(diff);
        if (!paths) return UNCERTAIN_AREAS;
        return areasForPaths(paths);
    } catch {
        return UNCERTAIN_AREAS;
    }
}

function publish(areas) {
    const body = `clippy=${areas.clippy}\nsidecar=${areas.sidecar}\nedge=${areas.edge}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, body);
    console.log(`ci-changed-areas clippy=${areas.clippy} sidecar=${areas.sidecar} edge=${areas.edge}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    publish(detectFromGit(process.env.BASE ?? '', process.env.HEAD ?? ''));
}
