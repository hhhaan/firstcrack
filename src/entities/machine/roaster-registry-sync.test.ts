/**
 * Dual roaster-registry sync (py ↔ ts).
 * Mirrors scripts/check-roaster-registry.mjs via Vite `?raw` so browser tsconfig
 * does not need Node types. CLI gate remains: pnpm check:registry.
 */
import { describe, expect, it } from 'vitest';
import pyText from '../../../src-tauri/sidecar/roaster_registry.py?raw';
import tsText from './roasterRegistry.ts?raw';

function sliceAssignmentBlock(text: string, startRe: RegExp): string {
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

function pyTopLevelObjectKeys(block: string): string[] {
    return [...block.matchAll(/^ {4}"([a-z0-9_]+)": \{/gm)].map((m) => m[1]);
}

function tsTopLevelObjectKeys(block: string): string[] {
    return [...block.matchAll(/^ {4}([a-z0-9_]+):\s*\{/gm)].map((m) => m[1]);
}

function pyTopLevelArrayKeys(block: string): string[] {
    return [...block.matchAll(/^ {4}"([a-z0-9_]+)": \[/gm)].map((m) => m[1]);
}

function tsTopLevelArrayKeys(block: string): string[] {
    return [...block.matchAll(/^ {4}([a-z0-9_]+):\s*\[/gm)].map((m) => m[1]);
}

function pyProtocols(block: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of block.matchAll(/^ {4}"([a-z0-9_]+)": \{([\s\S]*?)^ {4}\},?/gm)) {
        const pm = m[2].match(/"protocol"\s*:\s*"([a-z0-9_]+)"/);
        if (pm) out.set(m[1], pm[1]);
    }
    return out;
}

function tsProtocols(block: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of block.matchAll(/^ {4}([a-z0-9_]+):\s*\{([\s\S]*?)^ {4}\},?/gm)) {
        const pm = m[2].match(/protocol:\s*'([a-z0-9_]+)'|protocol:\s*"([a-z0-9_]+)"/);
        if (pm) out.set(m[1], pm[1] || pm[2]);
    }
    return out;
}

function sorted(keys: Iterable<string>): string[] {
    return [...keys].sort();
}

describe('roaster registry py↔ts sync', () => {
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

    it('key sets match', () => {
        expect(sorted(pyKeys)).toEqual(sorted(tsKeys));
    });

    it('protocol form key sets match', () => {
        expect(sorted(pyProtoKeys)).toEqual(sorted(tsProtoKeys));
    });

    it('per-key protocol fields match', () => {
        const pyProt = pyProtocols(pyRegistry);
        const tsProt = tsProtocols(tsRegistry);
        const mismatches: string[] = [];
        for (const key of sorted(pyKeys)) {
            if (!tsKeys.has(key)) continue;
            const a = pyProt.get(key);
            const b = tsProt.get(key);
            if (a == null || b == null || a !== b) {
                mismatches.push(`${key}: py=${a ?? '∅'} ts=${b ?? '∅'}`);
            }
        }
        expect(mismatches).toEqual([]);
    });
});
