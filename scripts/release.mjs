#!/usr/bin/env node
import { execSync } from 'node:child_process';

const version = process.argv[2];
const force = process.argv.includes('--force');
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error('Usage: node scripts/release.mjs <major.minor.patch> [--force]');
    process.exit(1);
}

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const fail = (msg) => {
    console.error(`\n❌ ${msg}`);
    console.error('   (검토 후 강행하려면 --force)');
    process.exit(1);
};

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

    // origin/main HEAD의 CI 게이트 5종이 전부 success인지 확인
    const gateChecks = ['typecheck', 'lint', 'eslint', 'test', 'sidecar'];
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
    const notGreen = runs.filter((r) => r.conclusion !== 'success');
    if (notGreen.length > 0) {
        fail(`CI가 green이 아님: ${notGreen.map((r) => `${r.name}=${r.conclusion ?? 'pending'}`).join(', ')}`);
    }
    process.stdout.write(`✅ 사전확인 통과 — HEAD=origin/main, CI ${runs.length}종 green\n`);
}

execSync(`node scripts/version-bump.mjs ${version}`, { stdio: 'inherit', cwd: process.cwd() });
execSync(`git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock`, {
    stdio: 'inherit',
});
execSync(`git commit -m "chore(release): bump version to ${version}"`, { stdio: 'inherit' });
execSync(`git tag v${version}`, { stdio: 'inherit' });
execSync(`git push origin main && git push origin v${version}`, { stdio: 'inherit' });
