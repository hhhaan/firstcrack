import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { crateVersionsFromLock, mismatchedPairs, npmVersionsFromLock } from './check-tauri-versions.mjs';

test('flags a minor skew and ignores rust-only crates and the cli package', () => {
    const mismatches = mismatchedPairs(
        new Map([
            ['@tauri-apps/api', '2.12.1'],
            ['@tauri-apps/plugin-fs', '2.6.0'],
            ['@tauri-apps/cli', '2.12.1'],
        ]),
        new Map([
            ['tauri', ['2.11.1']],
            ['tauri-plugin-fs', ['2.6.0']],
            ['tauri-plugin-shell', ['2.3.5']],
        ]),
    );
    assert.deepEqual(mismatches, [
        {
            crateName: 'tauri',
            crateVersion: '2.11.1',
            npmName: '@tauri-apps/api',
            npmVersion: '2.12.1',
        },
    ]);
});

test('patch difference on the same minor is ok', () => {
    const mismatches = mismatchedPairs(
        new Map([['@tauri-apps/plugin-dialog', '2.8.1']]),
        new Map([['tauri-plugin-dialog', ['2.8.2']]]),
    );
    assert.equal(mismatches.length, 0);
});

test('parses lockfile snippets', () => {
    const npm = npmVersionsFromLock(`
      '@tauri-apps/api':
        specifier: ^2
        version: 2.12.1
      '@tauri-apps/plugin-fs':
        specifier: ^2.6.0
        version: 2.6.0
`);
    const crates = crateVersionsFromLock(`
[[package]]
name = "tauri"
version = "2.12.3"
source = "registry+https://github.com/rust-lang/crates.io-index"
`);
    assert.equal(npm.get('@tauri-apps/api'), '2.12.1');
    assert.equal(npm.get('@tauri-apps/plugin-fs'), '2.6.0');
    assert.deepEqual(crates.get('tauri'), ['2.12.3']);
});

test('repo lockfiles are aligned', () => {
    execFileSync('node', ['scripts/check-tauri-versions.mjs'], { stdio: 'inherit' });
});
