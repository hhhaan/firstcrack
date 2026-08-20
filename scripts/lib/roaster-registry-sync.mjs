/**
 * Dual roaster-registry compare (Python connect SSoT ↔ TS UI mirror).
 *
 * Compared: top-level keys, per-key protocol, form-field keys, pid nullness,
 * default_params connect keys, capabilities.
 *
 * Address/write maps stay Python-only — not required in the TS mirror.
 */

/** Python-only connect payload (S7 channels, modbus maps, WS nodes). */
const PY_ONLY_PARAM_KEYS = new Set([
    'channels',
    'write_map',
    'modbus_registers',
    'channel_nodes',
    'pid_db',
    'pid_sv_register',
]);

const PY_REGISTRY_RE = /ROASTER_REGISTRY:\s*dict\[str,\s*dict\[str,\s*Any\]\]\s*=\s*\{/;
const TS_REGISTRY_RE = /const REGISTRY(?::[^=]+)?\s*=\s*\{/;
const PY_FORM_RE = /PROTOCOL_FORM_FIELDS:\s*dict\[str,\s*list\[dict\[str,\s*Any\]\]\]\s*=\s*\{/;
const TS_FORM_RE = /export const PROTOCOL_FORM_FIELDS(?::[^=]+)?\s*=\s*\{/;

function skipString(text, i) {
    const q = text[i];
    i++;
    while (i < text.length) {
        if (text[i] === '\\') {
            i += 2;
            continue;
        }
        if (text[i] === q) return i;
        i++;
    }
    return text.length - 1;
}

function skipLineComment(text, i) {
    const nl = text.indexOf('\n', i);
    return nl < 0 ? text.length - 1 : nl;
}

/** Inner content of `{...}` or `[...]` at `openIdx`. */
function sliceBalanced(text, openIdx) {
    const open = text[openIdx];
    const close = open === '{' ? '}' : open === '[' ? ']' : null;
    if (!close) throw new Error(`not a collection opener at index ${openIdx}`);
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' || ch === "'") {
            i = skipString(text, i);
            continue;
        }
        if (ch === '/' && text[i + 1] === '/') {
            i = skipLineComment(text, i);
            continue;
        }
        if (ch === '#') {
            i = skipLineComment(text, i);
            continue;
        }
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return text.slice(openIdx + 1, i);
        }
    }
    throw new Error(`unclosed ${open}`);
}

function skipWs(text, i) {
    while (i < text.length && /\s/.test(text[i])) i++;
    return i;
}

function sliceAssignmentBlock(text, startRe) {
    const m = startRe.exec(text);
    if (!m) throw new Error(`block not found: ${startRe}`);
    const openIdx = m.index + m[0].length - 1;
    const open = text[openIdx];
    if (open !== '{' && open !== '[') {
        throw new Error(`opening collection not found after ${startRe}`);
    }
    return sliceBalanced(text, openIdx);
}

/**
 * Top-level `    key: {` / `"key": [` entries (4-space indent).
 * @param {'{' | '['} open
 * @returns {Map<string, string>}
 */
function parseTopLevelKeyedBlocks(block, quoted, open) {
    const keyRe = quoted ? /^ {4}"([a-z0-9_]+)":/gm : /^ {4}([a-z0-9_]+):/gm;
    const map = new Map();
    for (const m of block.matchAll(keyRe)) {
        const openIdx = skipWs(block, m.index + m[0].length);
        if (block[openIdx] !== open) continue;
        map.set(m[1], sliceBalanced(block, openIdx));
    }
    return map;
}

function objectTopLevelKeys(inner, quoted) {
    const keys = [];
    let depth = 0;
    let i = 0;
    while (i < inner.length) {
        const ch = inner[i];
        if (ch === '/' && inner[i + 1] === '/') {
            i = skipLineComment(inner, i) + 1;
            continue;
        }
        if (ch === '#') {
            i = skipLineComment(inner, i) + 1;
            continue;
        }
        if (ch === '"' || ch === "'") {
            if (depth === 0 && quoted && ch === '"') {
                const m = inner.slice(i).match(/^"([a-z0-9_]+)"\s*:/);
                if (m) {
                    keys.push(m[1]);
                    i += m[0].length;
                    continue;
                }
            }
            i = skipString(inner, i) + 1;
            continue;
        }
        if (ch === '{' || ch === '[') {
            depth++;
            i++;
            continue;
        }
        if (ch === '}' || ch === ']') {
            depth--;
            i++;
            continue;
        }
        if (depth === 0 && !quoted) {
            const prev = i === 0 ? '' : inner[i - 1];
            if ((i === 0 || /[\s,{]/.test(prev)) && /[a-z]/.test(ch)) {
                const m = inner.slice(i).match(/^([a-z0-9_]+)\s*:/);
                if (m) {
                    keys.push(m[1]);
                    i += m[0].length;
                    continue;
                }
            }
        }
        i++;
    }
    return keys;
}

function parseProtocol(body, quoted) {
    const re = quoted ? /"protocol"\s*:\s*"([a-z0-9_]+)"/ : /\bprotocol:\s*['"]([a-z0-9_]+)['"]/;
    return re.exec(body)?.[1] ?? null;
}

/** @returns {'null' | 'object' | 'missing' | 'unknown'} */
function parsePidKind(body, quoted) {
    const re = quoted ? /"pid"\s*:/ : /\bpid\s*:/;
    const m = re.exec(body);
    if (!m) return 'missing';
    let i = m.index + m[0].length;
    while (i < body.length && /\s/.test(body[i])) i++;
    const rest = body.slice(i);
    if (quoted) {
        if (rest.startsWith('None')) return 'null';
        if (rest.startsWith('{')) return 'object';
    } else {
        if (rest.startsWith('null')) return 'null';
        if (rest.startsWith('{')) return 'object';
    }
    return 'unknown';
}

function parseCapabilities(body, quoted) {
    const re = quoted ? /"capabilities"\s*:/ : /\bcapabilities\s*:/;
    const m = re.exec(body);
    if (!m) return null;
    const openIdx = skipWs(body, m.index + m[0].length);
    if (body[openIdx] !== '[') return null;
    const inner = sliceBalanced(body, openIdx);
    return [...inner.matchAll(/['"]([a-z0-9_]+)['"]/g)].map((x) => x[1]);
}

function parseDefaultParamKeys(body, quoted) {
    const re = quoted ? /"default_params"\s*:/ : /\bdefault_params\s*:/;
    const m = re.exec(body);
    if (!m) return [];
    const openIdx = skipWs(body, m.index + m[0].length);
    if (body[openIdx] !== '{') return [];
    return objectTopLevelKeys(sliceBalanced(body, openIdx), quoted).filter((k) => !PY_ONLY_PARAM_KEYS.has(k));
}

function parseRegistryEntries(block, quoted) {
    const entries = parseTopLevelKeyedBlocks(block, quoted, '{');
    const out = new Map();
    for (const [key, body] of entries) {
        out.set(key, {
            protocol: parseProtocol(body, quoted),
            pid: parsePidKind(body, quoted),
            capabilities: parseCapabilities(body, quoted),
            defaultParamKeys: parseDefaultParamKeys(body, quoted),
        });
    }
    return out;
}

function uncommentLines(inner) {
    return inner
        .split('\n')
        .filter((line) => {
            const t = line.trim();
            return t && !t.startsWith('//') && !t.startsWith('#');
        })
        .join('\n');
}

function formFieldKeysFromArrayInner(inner, quoted) {
    const text = uncommentLines(inner);
    const re = quoted ? /"key"\s*:\s*"([a-z0-9_]+)"/g : /\bkey:\s*['"]([a-z0-9_]+)['"]/g;
    return [...text.matchAll(re)].map((m) => m[1]);
}

function expandTsArraySpreads(tsText, arrayInner) {
    return arrayInner.replace(/\.\.\.([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
        const re = new RegExp(`(?:export\\s+)?const ${name}(?::[^=]+)?\\s*=`);
        const m = re.exec(tsText);
        if (!m) throw new Error(`spread ${name} not found`);
        const openIdx = skipWs(tsText, m.index + m[0].length);
        if (tsText[openIdx] !== '[') {
            throw new Error(`spread ${name} is not an array`);
        }
        return sliceBalanced(tsText, openIdx);
    });
}

function parseFormFieldKeys(block, quoted, tsText) {
    const entries = parseTopLevelKeyedBlocks(block, quoted, '[');
    const out = new Map();
    for (const [key, inner] of entries) {
        const expanded = quoted ? inner : expandTsArraySpreads(tsText, inner);
        out.set(key, formFieldKeysFromArrayInner(expanded, quoted));
    }
    return out;
}

function diffSets(a, b) {
    const onlyA = [...a].filter((k) => !b.has(k)).sort();
    const onlyB = [...b].filter((k) => !a.has(k)).sort();
    return { onlyA, onlyB };
}

function fmtList(xs) {
    return xs.length ? xs.join(', ') : '∅';
}

function capsKey(caps) {
    if (caps == null) return '∅';
    return [...caps].sort().join(',');
}

/**
 * @param {string} pyText
 * @param {string} tsText
 * @returns {{ ok: boolean, logs: string[], errors: string[] }}
 */
export function compareRoasterRegistries(pyText, tsText) {
    const logs = [];
    const errors = [];

    const pyRegistry = sliceAssignmentBlock(pyText, PY_REGISTRY_RE);
    const tsRegistry = sliceAssignmentBlock(tsText, TS_REGISTRY_RE);
    const pyForm = sliceAssignmentBlock(pyText, PY_FORM_RE);
    const tsForm = sliceAssignmentBlock(tsText, TS_FORM_RE);

    const pyEntries = parseRegistryEntries(pyRegistry, true);
    const tsEntries = parseRegistryEntries(tsRegistry, false);
    const pyFormKeys = parseFormFieldKeys(pyForm, true);
    const tsFormKeys = parseFormFieldKeys(tsForm, false, tsText);

    const pyKeys = new Set(pyEntries.keys());
    const tsKeys = new Set(tsEntries.keys());
    const pyProtoKeys = new Set(pyFormKeys.keys());
    const tsProtoKeys = new Set(tsFormKeys.keys());

    const { onlyA: onlyPy, onlyB: onlyTs } = diffSets(pyKeys, tsKeys);
    logs.push(`roaster keys: py=${pyKeys.size} ts=${tsKeys.size}`);
    if (onlyPy.length || onlyTs.length) {
        if (onlyPy.length) errors.push(`  only in Python (missing UI mirror): ${onlyPy.join(', ')}`);
        if (onlyTs.length) errors.push(`  only in TypeScript (missing sidecar): ${onlyTs.join(', ')}`);
    } else {
        logs.push('  key sets: OK');
    }

    const { onlyA: onlyPyProto, onlyB: onlyTsProto } = diffSets(pyProtoKeys, tsProtoKeys);
    logs.push(`protocol form keys: py=${pyProtoKeys.size} ts=${tsProtoKeys.size}`);
    if (onlyPyProto.length || onlyTsProto.length) {
        if (onlyPyProto.length) errors.push(`  only in Python: ${onlyPyProto.join(', ')}`);
        if (onlyTsProto.length) errors.push(`  only in TypeScript: ${onlyTsProto.join(', ')}`);
    } else {
        logs.push('  protocol form key sets: OK');
    }

    const protocolMismatches = [];
    const pidMismatches = [];
    const paramMismatches = [];
    const capMismatches = [];
    for (const key of [...pyKeys].sort()) {
        if (!tsKeys.has(key)) continue;
        const py = pyEntries.get(key);
        const ts = tsEntries.get(key);
        if (py.protocol == null || ts.protocol == null || py.protocol !== ts.protocol) {
            protocolMismatches.push(`${key}: py=${py.protocol ?? '∅'} ts=${ts.protocol ?? '∅'}`);
        }
        if (py.pid !== ts.pid) {
            pidMismatches.push(`${key}: py=${py.pid} ts=${ts.pid}`);
        }
        const { onlyA, onlyB } = diffSets(new Set(py.defaultParamKeys), new Set(ts.defaultParamKeys));
        if (onlyA.length || onlyB.length) {
            paramMismatches.push(`${key}: py-only=[${fmtList(onlyA)}] ts-only=[${fmtList(onlyB)}]`);
        }
        if (capsKey(py.capabilities) !== capsKey(ts.capabilities)) {
            capMismatches.push(`${key}: py=[${fmtList(py.capabilities ?? [])}] ts=[${fmtList(ts.capabilities ?? [])}]`);
        }
    }
    if (protocolMismatches.length) {
        errors.push(`protocol field mismatches (${protocolMismatches.length}):`);
        for (const line of protocolMismatches.slice(0, 30)) errors.push(`  - ${line}`);
        if (protocolMismatches.length > 30) {
            errors.push(`  ... +${protocolMismatches.length - 30} more`);
        }
    } else {
        logs.push('  per-key protocol fields: OK');
    }

    const formFieldMismatches = [];
    for (const proto of [...pyProtoKeys].sort()) {
        if (!tsProtoKeys.has(proto)) continue;
        const { onlyA, onlyB } = diffSets(new Set(pyFormKeys.get(proto)), new Set(tsFormKeys.get(proto)));
        if (onlyA.length || onlyB.length) {
            formFieldMismatches.push(`${proto}: py-only=[${fmtList(onlyA)}] ts-only=[${fmtList(onlyB)}]`);
        }
    }
    if (formFieldMismatches.length) {
        errors.push(`form-field key mismatches (${formFieldMismatches.length}):`);
        for (const line of formFieldMismatches) errors.push(`  - ${line}`);
    } else {
        logs.push('  per-protocol form-field keys: OK');
    }

    if (pidMismatches.length) {
        errors.push(`pid nullness mismatches (${pidMismatches.length}):`);
        for (const line of pidMismatches) errors.push(`  - ${line}`);
    } else {
        logs.push('  per-key pid nullness: OK');
    }

    if (paramMismatches.length) {
        errors.push(`default_params connect-key mismatches (${paramMismatches.length}):`);
        for (const line of paramMismatches.slice(0, 40)) errors.push(`  - ${line}`);
        if (paramMismatches.length > 40) {
            errors.push(`  ... +${paramMismatches.length - 40} more`);
        }
    } else {
        logs.push('  per-key default_params connect keys: OK');
    }

    if (capMismatches.length) {
        errors.push(`capabilities mismatches (${capMismatches.length}):`);
        for (const line of capMismatches) errors.push(`  - ${line}`);
    } else {
        logs.push('  per-key capabilities: OK');
    }

    return { ok: errors.length === 0, logs, errors };
}
