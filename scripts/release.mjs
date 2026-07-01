#!/usr/bin/env node
import { execSync } from 'child_process';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error('Usage: node scripts/release.mjs <major.minor.patch>');
    process.exit(1);
}

execSync('node scripts/version-bump.mjs ' + version, { stdio: 'inherit', cwd: process.cwd() });
execSync(`git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock`, {
    stdio: 'inherit',
});
execSync(`git commit -m "chore(release): bump version to ${version}"`, { stdio: 'inherit' });
execSync(`git tag v${version}`, { stdio: 'inherit' });
execSync(`git push origin main && git push origin v${version}`, { stdio: 'inherit' });
