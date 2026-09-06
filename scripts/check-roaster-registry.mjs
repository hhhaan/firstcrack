/**
 * Dual roaster-registry sync check — the single parser (vitest calls this CLI).
 * Compares between:
 *   - src-tauri/sidecar/roaster_registry.py  (connect path)
 *   - src/entities/machine/roasterRegistry.ts (UI mirror)
 * Checked: top-level keys, per-key protocol, pid null-ness, capabilities,
 * default_params connect keys (address/write-map bodies stay Python-only),
 * and per-protocol form-field key lists.
 *
 * Python side is imported and JSON-dumped via the sidecar venv python (falls
 * back to python3), so it is exact. Only the TS side is text-scanned.
 *
 * Usage: node scripts/check-roaster-registry.mjs
 * Wired as: pnpm check:registry (also via pnpm verify)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIDECAR_DIR = join(root, 'src-tauri/sidecar');
const TS_PATH = join(root, 'src/entities/machine/roasterRegistry.ts');

/** default_params keys that intentionally live only in Python (map bodies must not be dumped into TS). */
const PY_ONLY_PARAM_KEYS = new Set([
    'write_map',
    'channels',
    'modbus_registers',
    'channel_nodes',
    'pid_db',
    'pid_sv_register',
    'word_order',
    'path',
]);

/** CLI status lines (biome noConsole allows warn/error only). */
const log = (msg) => {
    process.stdout.write(`${msg}\n`);
};

// ---------------------------------------------------------------------------
// Python side: exact dump via interpreter
// ---------------------------------------------------------------------------

function pythonBin() {
    for (const p of [join(SIDECAR_DIR, '.venv/bin/python'), join(SIDECAR_DIR, '.venv/Scripts/python.exe')]) {
        if (existsSync(p)) return p;
    }
    return 'python3';
}

function loadPython() {
    const code = [
        'import json, sys',
        `sys.path.insert(0, ${JSON.stringify(SIDECAR_DIR)})`,
        'import roaster_registry as r',
        'print(json.dumps({"registry": r.ROASTER_REGISTRY, "form": r.PROTOCOL_FORM_FIELDS}))',
    ].join('\n');
    return JSON.parse(execFileSync(pythonBin(), ['-c', code], { encoding: 'utf8' }));
}

// ---------------------------------------------------------------------------
// TS side: text scan
// ---------------------------------------------------------------------------

/** Remove `// ...` line comments (quote-aware). */
function stripLineComments(src) {
    let out = '';
    let inStr = null;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (inStr) {
            out += ch;
            if (ch === '\\') out += src[++i] ?? '';
            else if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            inStr = ch;
            out += ch;
            continue;
        }
        if (ch === '/' && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n') i++;
            out += '\n';
            continue;
        }
        out += ch;
    }
    return out;
}

/** Slice text from `startRe` match until the matching close bracket (depth from first `open`). */
function sliceBlock(text, startRe, open = '{', close = '}') {
    const m = startRe.exec(text);
    if (!m) throw new Error(`block not found: ${startRe}`);
    // Search from the end of the match so brackets inside type annotations
    // (e.g. `const X: RoasterDef['form_fields'] = [`) are not mistaken for the block start.
    const openIdx = text.indexOf(open, m.index + m[0].length - 1);
    if (openIdx < 0) throw new Error(`opening ${open} not found after ${startRe}`);
    let depth = 0;
    let inStr = null;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (ch === '\\') i++;
            else if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === "'" || ch === '"') inStr = ch;
        else if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return text.slice(openIdx + 1, i);
        }
    }
    throw new Error(`unclosed block for ${startRe}`);
}

/** Map of top-level `key: {...}` (or `key: [...]`) entries inside a block. */
function tsEntries(block, open = '{', close = '}') {
    const out = new Map();
    const re = new RegExp(`^ {4}([a-z0-9_]+):\\s*\\${open}`, 'gm');
    for (const m of block.matchAll(re)) {
        out.set(m[1], sliceBlock(block, new RegExp(`^ {4}${m[1]}:`, 'm'), open, close));
    }
    return out;
}

/** Top-level identifier keys of a TS object-literal body (depth/quote-aware). */
function objectTopKeys(block) {
    const keys = [];
    let depth = 0;
    let inStr = null;
    for (let i = 0; i < block.length; i++) {
        const ch = block[i];
        if (inStr) {
            if (ch === '\\') i++;
            else if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === "'" || ch === '"') inStr = ch;
        else if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') depth--;
        else if (depth === 0 && /[A-Za-z_]/.test(ch)) {
            const rest = block.slice(i);
            const key = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(rest);
            if (key) keys.push(key[1]);
            i += /^[A-Za-z0-9_]+/.exec(rest)[0].length - 1;
        }
    }
    return keys;
}

/** Ordered `key: '...'` list of a form-field array body, resolving `...CONST` spreads. */
function formFieldKeys(arrayBlock, fullText) {
    const keys = [];
    for (const m of arrayBlock.matchAll(/\bkey:\s*'([a-z0-9_]+)'|\.\.\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        if (m[1]) {
            keys.push(m[1]);
        } else {
            const spread = sliceBlock(fullText, new RegExp(`const ${m[2]}(?::[^=]+)?\\s*=\\s*\\[`), '[', ']');
            for (const sm of spread.matchAll(/\bkey:\s*'([a-z0-9_]+)'/g)) keys.push(sm[1]);
        }
    }
    return keys;
}

function loadTs() {
    const text = stripLineComments(readFileSync(TS_PATH, 'utf8'));
    const registryBlock = sliceBlock(text, /const REGISTRY(?::[^=]+)?\s*=\s*\{/);
    const formBlock = sliceBlock(text, /export const PROTOCOL_FORM_FIELDS(?::[^=]+)?\s*=\s*\{/);

    const registry = new Map();
    for (const [key, body] of tsEntries(registryBlock)) {
        const protocol = /\bprotocol:\s*'([a-z0-9_]+)'/.exec(body)?.[1] ?? null;
        const pidNull = /\bpid:\s*null/.test(body) ? true : /\bpid:\s*\{/.test(body) ? false : null;
        const capsBody = sliceBlock(body, /\bcapabilities:\s*\[/, '[', ']');
        const capabilities = [...capsBody.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
        const paramsBody = sliceBlock(body, /\bdefault_params:\s*\{/);
        registry.set(key, { protocol, pidNull, capabilities, paramKeys: objectTopKeys(paramsBody) });
    }

    const form = new Map();
    for (const [key, body] of tsEntries(formBlock, '[', ']')) {
        form.set(key, formFieldKeys(body, text));
    }
    return { registry, form };
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

const localeSort = (a, b) => String(a).localeCompare(String(b));

function diffSets(a, b) {
    const onlyA = [...a].filter((k) => !b.has(k)).sort(localeSort);
    const onlyB = [...b].filter((k) => !a.has(k)).sort(localeSort);
    return { onlyA, onlyB };
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function main() {
    const py = loadPython();
    const ts = loadTs();

    const pyKeys = new Set(Object.keys(py.registry));
    const tsKeys = new Set(ts.registry.keys());
    const failures = [];

    log(`roaster keys: py=${pyKeys.size} ts=${tsKeys.size}`);
    const { onlyA: onlyPy, onlyB: onlyTs } = diffSets(pyKeys, tsKeys);
    if (onlyPy.length) failures.push(`keys only in Python (missing UI mirror): ${onlyPy.join(', ')}`);
    if (onlyTs.length) failures.push(`keys only in TypeScript (missing sidecar): ${onlyTs.join(', ')}`);

    for (const key of [...pyKeys].sort(localeSort)) {
        if (!tsKeys.has(key)) continue;
        const p = py.registry[key];
        const t = ts.registry.get(key);

        if (p.protocol !== t.protocol) {
            failures.push(`${key}: protocol py=${p.protocol} ts=${t.protocol}`);
        }
        const pyPidNull = p.pid == null;
        if (pyPidNull !== t.pidNull) {
            failures.push(`${key}: pid py=${pyPidNull ? 'null' : 'object'} ts=${t.pidNull ? 'null' : 'object'}`);
        }
        if (!eq(p.capabilities ?? [], t.capabilities)) {
            failures.push(
                `${key}: capabilities py=[${(p.capabilities ?? []).join(',')}] ts=[${t.capabilities.join(',')}]`,
            );
        }
        const pyParams = Object.keys(p.default_params ?? {})
            .filter((k) => !PY_ONLY_PARAM_KEYS.has(k))
            .sort(localeSort);
        const leaked = t.paramKeys.filter((k) => PY_ONLY_PARAM_KEYS.has(k));
        if (leaked.length) {
            failures.push(`${key}: Python-only map keys dumped into TS default_params: ${leaked.join(', ')}`);
        }
        if (!eq(pyParams, [...t.paramKeys].sort(localeSort))) {
            failures.push(
                `${key}: default_params keys py=[${pyParams.join(',')}] ts=[${[...t.paramKeys].sort(localeSort).join(',')}]`,
            );
        }
    }

    const pyProtoKeys = new Set(Object.keys(py.form));
    const tsProtoKeys = new Set(ts.form.keys());
    log(`protocol form keys: py=${pyProtoKeys.size} ts=${tsProtoKeys.size}`);
    const { onlyA: onlyPyProto, onlyB: onlyTsProto } = diffSets(pyProtoKeys, tsProtoKeys);
    if (onlyPyProto.length) failures.push(`form protocols only in Python: ${onlyPyProto.join(', ')}`);
    if (onlyTsProto.length) failures.push(`form protocols only in TypeScript: ${onlyTsProto.join(', ')}`);

    for (const proto of [...pyProtoKeys].sort(localeSort)) {
        if (!tsProtoKeys.has(proto)) continue;
        const pyFields = py.form[proto].map((f) => f.key);
        const tsFields = ts.form.get(proto);
        if (!eq(pyFields, tsFields)) {
            failures.push(`form[${proto}]: field keys py=[${pyFields.join(',')}] ts=[${tsFields.join(',')}]`);
        }
    }

    if (failures.length) {
        console.error(`roaster registry sync: ${failures.length} mismatch(es)`);
        for (const f of failures) console.error(`  - ${f}`);
        console.error(
            '\nFix: update both src-tauri/sidecar/roaster_registry.py and src/entities/machine/roasterRegistry.ts',
        );
        process.exit(1);
    }
    log('\nroaster registry sync: OK');
}

main();
