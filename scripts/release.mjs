#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const arg = process.argv[2];
const force = process.argv.includes('--force');
const BUMP_KINDS = new Set(['patch', 'minor', 'major']);
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const TAG_RE = /^v\d+\.\d+\.\d+$/;

if (!arg || (!SEMVER_RE.test(arg) && !BUMP_KINDS.has(arg))) {
    console.error('Usage: node scripts/release.mjs <major.minor.patch|patch|minor|major> [--force]');
    process.exit(1);
}

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const fail = (msg) => {
    console.error(`\n❌ ${msg}`);
    if (!force) console.error('   (사전확인 스킵: --force — 다운그레이드/기존 태그는 강행 불가)');
    process.exit(1);
};

const parse = (v) => v.split('.').map(Number);
const cmp = (a, b) => {
    const [am, an, ap] = parse(a);
    const [bm, bn, bp] = parse(b);
    return am - bm || an - bn || ap - bp;
};
const fmt = ([m, n, p]) => `${m}.${n}.${p}`;
const bump = (v, kind) => {
    const [m, n, p] = parse(v);
    if (kind === 'major') return fmt([m + 1, 0, 0]);
    if (kind === 'minor') return fmt([m, n + 1, 0]);
    return fmt([m, n, p + 1]);
};
const toVersions = (tags) =>
    tags
        .map((t) => t.trim())
        .filter((t) => TAG_RE.test(t))
        .map((t) => t.slice(1));

const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!SEMVER_RE.test(pkgVersion)) {
    fail(`package.json version 비정상: ${pkgVersion}`);
}

const localTagVersions = toVersions(sh("git tag -l 'v*'").split('\n'));

let remoteTagVersions = [];
try {
    // refs/tags/v1.0.0 또는 refs/tags/v1.0.0^{} (annotated)
    remoteTagVersions = toVersions(
        sh('git ls-remote --tags origin')
            .split('\n')
            .map((line) => line.split(/[\t ]+/).at(-1) ?? '')
            .map((ref) => ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, ''))
            .filter(Boolean),
    );
} catch {
    console.warn('⚠️ remote 태그 조회 실패 — 로컬 태그 + package.json 기준 사용');
}

const allKnown = [...new Set([pkgVersion, ...localTagVersions, ...remoteTagVersions])];
const baseline = allKnown.sort(cmp).at(-1);
const maxTag = [...new Set([...localTagVersions, ...remoteTagVersions])].sort(cmp).at(-1);
const version = BUMP_KINDS.has(arg) ? bump(baseline, arg) : arg;

// 다운그레이드/동일 버전 — --force 로도 불가
if (cmp(version, baseline) <= 0) {
    console.error(
        `\n❌ 다운그레이드/동일 버전 금지: target=${version} ≤ baseline=${baseline} (package.json=${pkgVersion}, max-tag=${maxTag ? `v${maxTag}` : '—'})`,
    );
    process.exit(1);
}

const tagName = `v${version}`;
if (localTagVersions.includes(version) || remoteTagVersions.includes(version)) {
    console.error(`\n❌ 태그 이미 존재: ${tagName}`);
    process.exit(1);
}

if (BUMP_KINDS.has(arg)) {
    process.stdout.write(`📦 auto-bump ${arg}: ${baseline} → ${version}\n`);
}

// 태그 전 사전확인 — v1.1.16(red CI 태그) / v1.1.18(push head 아닌 커밋 태그) 재발 방지
if (!force) {
    if (sh('git status --porcelain') !== '') {
        fail('working tree가 clean하지 않음 — 커밋/스태시 후 릴리스');
    }

    execSync('git fetch origin main', { stdio: 'inherit' });
    const head = sh('git rev-parse HEAD');
    const originMain = sh('git rev-parse origin/main');
    if (head !== originMain) {
        fail(
            `HEAD(${head.slice(0, 7)}) ≠ origin/main(${originMain.slice(0, 7)}) — push 안 된 커밋 위에 태그를 끊으면 릴리스 게이트가 check-run을 찾지 못해 실패함`,
        );
    }

    // origin/main HEAD의 CI 게이트가 green인지 (이름 = ci.yml job id).
    // ios-check is skipped when src-tauri did not change — treat skipped as pass.
    const gateChecks = ['paths', 'check', 'test', 'sidecar', 'ios-check', 'semgrep'];
    let runs;
    try {
        runs = JSON.parse(
            sh(`gh api "repos/{owner}/{repo}/commits/${head}/check-runs" --jq '[.check_runs[] | {name, conclusion}]'`),
        ).filter((r) => gateChecks.includes(r.name));
    } catch {
        fail('gh api로 CI 상태 조회 실패 — gh auth 확인');
    }
    if (runs.length === 0) {
        fail('이 커밋에 CI check-run이 없음 (docs-only push로 CI 스킵?) — CI가 붙은 커밋에서 릴리스');
    }
    const notGreen = runs.filter((r) => r.conclusion !== 'success' && r.conclusion !== 'skipped');
    if (notGreen.length > 0) {
        fail(`CI가 green이 아님: ${notGreen.map((r) => `${r.name}=${r.conclusion ?? 'pending'}`).join(', ')}`);
    }
    process.stdout.write(`✅ 사전확인 통과 — HEAD=origin/main, CI ${runs.length}종 green, release ${version}\n`);
}

execSync(`node scripts/version-bump.mjs ${version}`, { stdio: 'inherit', cwd: process.cwd() });
execSync(`git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock`, {
    stdio: 'inherit',
});
execSync(`git commit -m "chore(release): bump version to ${version}"`, { stdio: 'inherit' });
execSync(`git tag ${tagName}`, { stdio: 'inherit' });
// --atomic: 한 번의 push = pre-push verify:all 1회. 비원자적 2회 push는 main 거부 시
// 태그만 올라가 "push 안 된 커밋에 태그"(v1.1.18) 재발.
execSync(`git push --atomic origin main ${tagName}`, { stdio: 'inherit' });
