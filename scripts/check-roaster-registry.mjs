/**
 * Dual roaster-registry sync check.
 * Compares top-level keys (and per-key protocol) between:
 *   - src-tauri/sidecar/roaster_registry.py  (connect path)
 *   - src/entities/machine/roasterRegistry.ts (UI mirror)
 *
 * Usage: node scripts/check-roaster-registry.mjs
 * Wired as: pnpm check:registry (also via pnpm verify)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PY_PATH = join(root, 'src-tauri/sidecar/roaster_registry.py');
const TS_PATH = join(root, 'src/entities/machine/roasterRegistry.ts');

/** CLI status lines (biome noConsole allows warn/error only). */
const log = (msg) => {
    process.stdout.write(`${msg}\n`);
};

/**
 * Slice text from `startRe` match end until the matching closing brace at the
 * same indent as the opening line (simple brace depth from that point).
 */
function sliceAssignmentBlock(text, startRe) {
    const m = startRe.exec(text);
    if (!m) throw new Error(`block not found: ${startRe}`);
    const openIdx = text.indexOf('{', m.index);
    if (openIdx < 0) throw new Error(`opening { not found after ${startRe}`);
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(openIdx + 1, i);
        }
    }
    throw new Error(`unclosed block for ${startRe}`);
}

/** Top-level `"key": {` entries (Python dict). */
function pyTopLevelObjectKeys(block) {
    return [...block.matchAll(/^ {4}"([a-z0-9_]+)": \{/gm)].map((m) => m[1]);
}

/** Top-level `key: {` entries (TS object literal at 4-space indent). */
function tsTopLevelObjectKeys(block) {
    return [...block.matchAll(/^ {4}([a-z0-9_]+):\s*\{/gm)].map((m) => m[1]);
}

/** Top-level `"key": [` (Python PROTOCOL_FORM_FIELDS). */
function pyTopLevelArrayKeys(block) {
    return [...block.matchAll(/^ {4}"([a-z0-9_]+)": \[/gm)].map((m) => m[1]);
}

/** Top-level `key: [` (TS PROTOCOL_FORM_FIELDS). */
function tsTopLevelArrayKeys(block) {
    return [...block.matchAll(/^ {4}([a-z0-9_]+):\s*\[/gm)].map((m) => m[1]);
}

/** Map roasterKey → protocol string for py registry entries. */
function pyProtocols(block) {
    const out = new Map();
    for (const m of block.matchAll(/^ {4}"([a-z0-9_]+)": \{([\s\S]*?)^ {4}\},?/gm)) {
        const pm = m[2].match(/"protocol"\s*:\s*"([a-z0-9_]+)"/);
        if (pm) out.set(m[1], pm[1]);
    }
    return out;
}

/** Map roasterKey → protocol string for ts REGISTRY entries. */
function tsProtocols(block) {
    const out = new Map();
    for (const m of block.matchAll(/^ {4}([a-z0-9_]+):\s*\{([\s\S]*?)^ {4}\},?/gm)) {
        const pm = m[2].match(/protocol:\s*'([a-z0-9_]+)'|protocol:\s*"([a-z0-9_]+)"/);
        if (pm) out.set(m[1], pm[1] || pm[2]);
    }
    return out;
}

function diffSets(a, b) {
    const onlyA = [...a].filter((k) => !b.has(k)).sort();
    const onlyB = [...b].filter((k) => !a.has(k)).sort();
    return { onlyA, onlyB };
}

function main() {
    const pyText = readFileSync(PY_PATH, 'utf8');
    const tsText = readFileSync(TS_PATH, 'utf8');

    const pyRegistry = sliceAssignmentBlock(pyText, /ROASTER_REGISTRY:\s*dict\[str,\s*dict\[str,\s*Any\]\]\s*=\s*\{/);
    const tsRegistry = sliceAssignmentBlock(tsText, /const REGISTRY(?::[^=]+)?\s*=\s*\{/);

    const pyForm = sliceAssignmentBlock(
        pyText,
        /PROTOCOL_FORM_FIELDS:\s*dict\[str,\s*list\[dict\[str,\s*Any\]\]\]\s*=\s*\{/,
    );
    const tsForm = sliceAssignmentBlock(tsText, /export const PROTOCOL_FORM_FIELDS(?::[^=]+)?\s*=\s*\{/);

    const pyKeys = new Set(pyTopLevelObjectKeys(pyRegistry));
    const tsKeys = new Set(tsTopLevelObjectKeys(tsRegistry));
    const pyProtoKeys = new Set(pyTopLevelArrayKeys(pyForm));
    const tsProtoKeys = new Set(tsTopLevelArrayKeys(tsForm));

    let failed = false;

    const { onlyA: onlyPy, onlyB: onlyTs } = diffSets(pyKeys, tsKeys);
    log(`roaster keys: py=${pyKeys.size} ts=${tsKeys.size}`);
    if (onlyPy.length || onlyTs.length) {
        failed = true;
        if (onlyPy.length) {
            console.error(`  only in Python (missing UI mirror): ${onlyPy.join(', ')}`);
        }
        if (onlyTs.length) {
            console.error(`  only in TypeScript (missing sidecar): ${onlyTs.join(', ')}`);
        }
    } else {
        log('  key sets: OK');
    }

    const { onlyA: onlyPyProto, onlyB: onlyTsProto } = diffSets(pyProtoKeys, tsProtoKeys);
    log(`protocol form keys: py=${pyProtoKeys.size} ts=${tsProtoKeys.size}`);
    if (onlyPyProto.length || onlyTsProto.length) {
        failed = true;
        if (onlyPyProto.length) {
            console.error(`  only in Python: ${onlyPyProto.join(', ')}`);
        }
        if (onlyTsProto.length) {
            console.error(`  only in TypeScript: ${onlyTsProto.join(', ')}`);
        }
    } else {
        log('  protocol form key sets: OK');
    }

    // Per-key protocol string must match on the intersection
    const pyProt = pyProtocols(pyRegistry);
    const tsProt = tsProtocols(tsRegistry);
    const protocolMismatches = [];
    for (const key of [...pyKeys].sort()) {
        if (!tsKeys.has(key)) continue;
        const a = pyProt.get(key);
        const b = tsProt.get(key);
        if (a == null || b == null) {
            protocolMismatches.push(`${key}: py=${a ?? '∅'} ts=${b ?? '∅'}`);
            continue;
        }
        if (a !== b) protocolMismatches.push(`${key}: py=${a} ts=${b}`);
    }
    if (protocolMismatches.length) {
        failed = true;
        console.error(`protocol field mismatches (${protocolMismatches.length}):`);
        for (const line of protocolMismatches.slice(0, 30)) console.error(`  - ${line}`);
        if (protocolMismatches.length > 30) {
            console.error(`  ... +${protocolMismatches.length - 30} more`);
        }
    } else {
        log('  per-key protocol fields: OK');
    }

    if (failed) {
        console.error(
            '\nFix: update both src-tauri/sidecar/roaster_registry.py and src/entities/machine/roasterRegistry.ts',
        );
        process.exit(1);
    }
    log('\nroaster registry sync: OK');
}

main();
