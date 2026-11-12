#!/usr/bin/env node
/**
 * Guard: packaged Tauri webviews need wasm-unsafe-eval for @react-pdf/yoga-layout WASM,
 * and worker-src blob: for fflate zlib Workers when PDFs embed PNGs with alpha (png-js).
 * Tauri merges this with asset hashes on script-src at build time — do not use unsafe-eval.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} csp @param {string} directive */
function directiveValues(csp, directive) {
    const want = directive.toLowerCase();
    for (const part of csp.split(';')) {
        const tokens = part.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) {
            continue;
        }
        if (tokens[0].toLowerCase() !== want) {
            continue;
        }
        return tokens.slice(1);
    }
    return null;
}

/** @param {string} csp */
function scriptSrcValues(csp) {
    return directiveValues(csp, 'script-src');
}

/** @param {string} csp */
function workerSrcValues(csp) {
    return directiveValues(csp, 'worker-src');
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
    const lowerValues = values.map((v) => v.toLowerCase());
    if (!lowerValues.includes("'self'")) {
        return "app.security.csp script-src must include 'self' (same-origin bundles are not covered by default-src)";
    }
    if (!lowerValues.includes("'wasm-unsafe-eval'")) {
        return "app.security.csp script-src must include 'wasm-unsafe-eval' (PDF export / yoga-layout WASM)";
    }
    if (lowerValues.includes("'unsafe-eval'")) {
        return "app.security.csp script-src must not include 'unsafe-eval' (use 'wasm-unsafe-eval' only)";
    }
    const workerValues = workerSrcValues(csp);
    if (workerValues === null) {
        return "app.security.csp must declare worker-src 'self' blob: (PNG alpha in PDF export / fflate zlib worker)";
    }
    const lowerWorker = workerValues.map((v) => v.toLowerCase());
    if (!lowerWorker.includes("'self'") || !lowerWorker.includes('blob:')) {
        return "app.security.csp worker-src must include 'self' and blob: (PNG alpha in PDF export / fflate zlib worker)";
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
    console.log(
        "check-tauri-csp: OK (script-src 'self' + wasm-unsafe-eval; worker-src 'self' + blob:; no unsafe-eval)",
    );
}
