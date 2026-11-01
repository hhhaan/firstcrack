import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { validateTauriCsp } from './check-tauri-csp.mjs';

test('rejects missing wasm-unsafe-eval and bare unsafe-eval', () => {
    assert.match(validateTauriCsp("default-src 'self'"), /script-src/u);
    assert.match(validateTauriCsp("script-src 'self' 'unsafe-eval'"), /unsafe-eval/u);
    assert.equal(validateTauriCsp("script-src 'self' 'wasm-unsafe-eval'"), null);
});

test('repo tauri.conf.json CSP passes', () => {
    const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
    assert.equal(validateTauriCsp(conf.app.security.csp), null);
    execFileSync('node', ['scripts/check-tauri-csp.mjs'], { stdio: 'inherit' });
});
