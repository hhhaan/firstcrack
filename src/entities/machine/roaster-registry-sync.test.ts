/**
 * Dual roaster-registry sync (py ↔ ts).
 * Uses scripts/lib/roaster-registry-sync.mjs (same checker as pnpm check:registry).
 */
import { describe, expect, it } from 'vitest';
import { compareRoasterRegistries } from '../../../scripts/lib/roaster-registry-sync.mjs';
import pyText from '../../../src-tauri/sidecar/roaster_registry.py?raw';
import { useMachines, VIRTUAL_ID } from './model';
import { ROASTER_REGISTRY } from './roasterRegistry';
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

    it('fails when TS default_params dumps a py-only key', () => {
        const py = pyFixture('null').replace(
            '"default_params": { "mode": "C" }',
            '"default_params": { "mode": "C", "write_map": { "heater": {} } }',
        );
        const ts = tsFixture('null').replace(
            "default_params: { mode: 'C' }",
            "default_params: { mode: 'C', write_map: { heater: {} } }",
        );
        const result = compareRoasterRegistries(py, ts);
        expect(result.ok).toBe(false);
        expect(result.errors.some((line: string) => /ts-only=\[write_map\]/.test(line))).toBe(true);
    });

    it('expands python *splat form fields against ts spreads', () => {
        const py = `
ROASTER_REGISTRY: dict[str, dict[str, Any]] = {
    "virtual": {
        "protocol": "virtual",
        "pid": None,
        "capabilities": [],
        "default_params": {},
    },
}
_SERIAL_FORM_FIELDS: list[dict[str, Any]] = [
    {"key": "comport", "label": "Serial Port", "type": "text", "required": False},
    {"key": "bytesize", "label": "Byte Size", "type": "number", "required": False},
]
PROTOCOL_FORM_FIELDS: dict[str, list[dict[str, Any]]] = {
    "virtual": [],
    "modbus": [
        {"key": "mode", "label": "Connection", "type": "select", "required": True},
        *_SERIAL_FORM_FIELDS,
    ],
}
`;
        const ts = `
const SERIAL_FORM_FIELDS = [
    { key: 'comport', label: 'Serial Port', type: 'text', required: false },
    { key: 'bytesize', label: 'Byte Size', type: 'number', required: false },
];
const REGISTRY = {
    virtual: {
        protocol: 'virtual',
        pid: null,
        capabilities: [],
        default_params: {},
    },
};
export const PROTOCOL_FORM_FIELDS = {
    virtual: [],
    modbus: [
        { key: 'mode', label: 'Connection', type: 'select', required: true },
        ...SERIAL_FORM_FIELDS,
    ],
};
`;
        const result = compareRoasterRegistries(py, ts);
        expect(result.errors, result.errors.join('\n')).toEqual([]);
        expect(result.ok).toBe(true);
    });

    it('VIRTUAL_MACHINE mirrors registry virtual capabilities/pid', () => {
        const vm = useMachines.getState().machines.find((m) => m.id === VIRTUAL_ID);
        expect(vm?.capabilities).toEqual(ROASTER_REGISTRY.virtual.capabilities);
        expect(vm?.pid).toEqual(ROASTER_REGISTRY.virtual.pid);
        expect(vm?.pid).not.toBeNull();
    });
});
