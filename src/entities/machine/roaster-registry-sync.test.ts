/**
 * Dual roaster-registry sync (py ↔ ts).
 * Uses scripts/lib/roaster-registry-sync.mjs (same checker as pnpm check:registry).
 */
import { describe, expect, it } from 'vitest';
import { compareRoasterRegistries } from '../../../scripts/lib/roaster-registry-sync.mjs';
import pyText from '../../../src-tauri/sidecar/roaster_registry.py?raw';
import tsText from './roasterRegistry.ts?raw';

const pyFixture = (pid: string) => `
ROASTER_REGISTRY: dict[str, dict[str, Any]] = {
    "virtual": {
        "protocol": "virtual",
        "pid": ${pid},
        "capabilities": ["heater"],
        "default_params": { "mode": "C" },
    },
}
PROTOCOL_FORM_FIELDS: dict[str, list[dict[str, Any]]] = {
    "virtual": [],
}
`;

const tsFixture = (pid: string) => `
const REGISTRY = {
    virtual: {
        protocol: 'virtual',
        pid: ${pid},
        capabilities: ['heater'],
        default_params: { mode: 'C' },
    },
};
export const PROTOCOL_FORM_FIELDS = {
    virtual: [],
};
`;

describe('roaster registry py↔ts sync', () => {
    it('real files stay in sync (same checker as check:registry)', () => {
        const result = compareRoasterRegistries(pyText, tsText);
        expect(result.errors, result.errors.join('\n')).toEqual([]);
        expect(result.ok).toBe(true);
    });

    it('fails when pid nullness differs', () => {
        const result = compareRoasterRegistries(pyFixture('{ "Kp": 4, "Ki": 0.3, "Kd": 2 }'), tsFixture('null'));
        expect(result.ok).toBe(false);
        expect(result.errors.some((line: string) => /pid nullness/.test(line))).toBe(true);
        expect(result.errors.some((line: string) => /virtual: py=object ts=null/.test(line))).toBe(true);
    });

    it('passes when pid nullness matches', () => {
        const result = compareRoasterRegistries(
            pyFixture('{ "Kp": 4, "Ki": 0.3, "Kd": 2 }'),
            tsFixture('{ Kp: 4, Ki: 0.3, Kd: 2 }'),
        );
        expect(result.errors, result.errors.join('\n')).toEqual([]);
        expect(result.ok).toBe(true);
    });
});
