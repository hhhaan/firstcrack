#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error('Usage: node scripts/version-bump.mjs <major.minor.patch>');
    process.exit(1);
}

const replaceVersion = (content) => content.replace(/"version": "[^"]*"/, `"version": "${version}"`);

writeFileSync('src-tauri/tauri.conf.json', replaceVersion(readFileSync('src-tauri/tauri.conf.json', 'utf8')));
writeFileSync('package.json', replaceVersion(readFileSync('package.json', 'utf8')));

const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8');
writeFileSync('src-tauri/Cargo.toml', cargo.replace(/^version = ".*"/m, `version = "${version}"`));

execSync(`cargo update -p roastery-agent --precise ${version} --manifest-path src-tauri/Cargo.toml`, {
    stdio: 'inherit',
});

console.log(`Bumped to ${version}: package.json, tauri.conf.json, Cargo.toml, Cargo.lock`);
