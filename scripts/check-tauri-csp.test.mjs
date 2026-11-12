import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateTauriCsp } from './check-tauri-csp.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptsDir, '..');

test('rejects CSP without script-src directive', () => {
    assert.match(validateTauriCsp("default-src 'self'"), /script-src/u);
});

test("rejects script-src missing 'self'", () => {
    assert.match(validateTauriCsp("script-src 'wasm-unsafe-eval'"), /'self'/u);
});

test("rejects script-src containing 'unsafe-eval'", () => {
    assert.match(validateTauriCsp("script-src 'self' 'unsafe-eval'"), /unsafe-eval/u);
});

test('accepts valid script-src and worker-src', () => {
    assert.equal(validateTauriCsp("script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:"), null);
});

test('rejects CSP without worker-src directive', () => {
    assert.match(validateTauriCsp("script-src 'self' 'wasm-unsafe-eval'"), /worker-src/u);
});

test('rejects worker-src without blob:', () => {
    assert.match(validateTauriCsp("script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'"), /blob:/u);
});

test("rejects worker-src missing 'self'", () => {
    assert.match(validateTauriCsp("script-src 'self' 'wasm-unsafe-eval'; worker-src blob:"), /'self'/u);
});

test('script-src-elem before script-src is not treated as script-src', () => {
    assert.match(
        validateTauriCsp("script-src-elem 'self'; script-src 'wasm-unsafe-eval'; worker-src 'self' blob:"),
        /'self'/u,
    );
});

test('repo tauri.conf.json CSP passes', () => {
    const conf = JSON.parse(readFileSync(join(repoRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
    assert.equal(validateTauriCsp(conf.app.security.csp), null);
    execFileSync(process.execPath, [join(scriptsDir, 'check-tauri-csp.mjs')], { stdio: 'inherit' });
});
