#!/usr/bin/env node
/**
 * Guard: packaged Tauri webviews need wasm-unsafe-eval for @react-pdf/yoga-layout WASM.
 * Tauri merges this with asset hashes on script-src at build time — do not use unsafe-eval.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} csp */
function scriptSrcValues(csp) {
    for (const part of csp.split(';')) {
        const trimmed = part.trim();
        if (!trimmed.startsWith('script-src')) {
            continue;
        }
        const rest = trimmed.slice('script-src'.length).trim();
        return rest ? rest.split(/\s+/) : [];
    }
    return null;
}

/** @param {unknown} csp */
export function validateTauriCsp(csp) {
    if (typeof csp !== 'string' || !csp.trim()) {
        return 'app.security.csp must be a non-empty string';
    }
    const values = scriptSrcValues(csp);
    if (values === null) {
        return "app.security.csp must declare script-src with 'self' and 'wasm-unsafe-eval'";
    }
    if (!values.includes("'self'")) {
        return "app.security.csp script-src must include 'self' (same-origin bundles are not covered by default-src)";
    }
    if (!values.includes("'wasm-unsafe-eval'")) {
        return "app.security.csp script-src must include 'wasm-unsafe-eval' (PDF export / yoga-layout WASM)";
    }
    if (values.includes("'unsafe-eval'")) {
        return "app.security.csp script-src must not include 'unsafe-eval' (use 'wasm-unsafe-eval' only)";
    }
    return null;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
    const conf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
    const error = validateTauriCsp(conf.app?.security?.csp);
    if (error) {
        console.error(`check-tauri-csp: ${error}`);
        process.exit(1);
    }
    console.log("check-tauri-csp: OK (script-src includes 'self' and 'wasm-unsafe-eval', no 'unsafe-eval')\n");
}
