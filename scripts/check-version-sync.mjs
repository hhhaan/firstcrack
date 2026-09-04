#!/usr/bin/env node
// Pre-commit guard: ensures the version is identical across all release files
// AS THEY WILL BE COMMITTED (git index), so partial staging cannot desync them.
import { execSync } from 'child_process';

// Read a file's content from the git index (what is about to be committed).
// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process — path is a literal below
const fromIndex = (path) => execSync(`git show :${path}`, { encoding: 'utf8' });

const first = (content, regex, label) => {
    const m = content.match(regex);
    if (!m) {
        console.error(`check-version-sync: could not find version in ${label}`);
        process.exit(1);
    }
    return m[1];
};

const versions = {
    'package.json': first(fromIndex('package.json'), /"version": "([^"]*)"/, 'package.json'),
    'tauri.conf.json': first(fromIndex('src-tauri/tauri.conf.json'), /"version": "([^"]*)"/, 'tauri.conf.json'),
    'Cargo.toml': first(fromIndex('src-tauri/Cargo.toml'), /^version = "(.*)"/m, 'Cargo.toml'),
    'Cargo.lock': first(fromIndex('src-tauri/Cargo.lock'), /name = "roastery-agent"\nversion = "(.*)"/, 'Cargo.lock'),
};

const unique = [...new Set(Object.values(versions))];
if (unique.length > 1) {
    console.error('check-version-sync: version mismatch in staged files:');
    for (const [file, v] of Object.entries(versions)) console.error(`  ${file.padEnd(16)} ${v}`);
    console.error('\nRun `pnpm version:bump <x.y.z>` and stage ALL changed files together.');
    process.exit(1);
}
