import { describe, expect, it } from 'vitest';
import {
    copyMachineSnapshot,
    EMPTY_MACHINE_SNAPSHOT,
    isRoasterFieldVisible,
    snapshotFromSidecar,
    writeMapFormFlags,
} from './lib';
import { ROASTER_REGISTRY } from './roasterRegistry';
import type { Machine } from './types';

it('keeps W60A door switches out of the machine connection form', () => {
    const definition = ROASTER_REGISTRY.giesen_w45a_w60a;
    expect(definition.form_fields.some((field) => field.key === 'w60a_discharge' || field.key === 'w60a_fill')).toBe(
        false,
    );
    expect(definition.default_params).not.toHaveProperty('w60a_discharge');
    expect(definition.default_params).not.toHaveProperty('w60a_fill');
});

describe('isRoasterFieldVisible', () => {
    it.each(['rtu', 'ascii', 'serial'])('serial mode %s hides TCP fields, shows serial fields', (mode) => {
        expect(isRoasterFieldVisible('host', mode)).toBe(false);
        expect(isRoasterFieldVisible('port', mode)).toBe(false);
        expect(isRoasterFieldVisible('comport', mode)).toBe(true);
        expect(isRoasterFieldVisible('baudrate', mode)).toBe(true);
    });

    it.each(['tcp', 'udp'])('network mode %s hides serial fields, shows TCP fields', (mode) => {
        expect(isRoasterFieldVisible('host', mode)).toBe(true);
        expect(isRoasterFieldVisible('comport', mode)).toBe(false);
        expect(isRoasterFieldVisible('baudrate', mode)).toBe(false);
    });

    it('unknown/empty mode shows everything', () => {
        expect(isRoasterFieldVisible('host', undefined)).toBe(true);
        expect(isRoasterFieldVisible('comport', '')).toBe(true);
    });
});

describe('writeMapFormFlags', () => {
    it('includeWriteMap equals showWriteMap in every case', () => {
        const cases = [
            { isCustom: true, protocol: 's7', canConfigureControl: true },
            { isCustom: true, protocol: 's7', canConfigureControl: false },
            { isCustom: true, protocol: 'modbus', canConfigureControl: true },
            { isCustom: false, protocol: 's7', canConfigureControl: true },
        ];
        for (const input of cases) {
            const { showWriteMap, includeWriteMap } = writeMapFormFlags(input);
            expect(includeWriteMap).toBe(showWriteMap);
        }
    });

    it('is on only for custom s7 with the plan flag', () => {
        expect(writeMapFormFlags({ isCustom: true, protocol: 's7', canConfigureControl: true }).includeWriteMap).toBe(
            true,
        );
        expect(writeMapFormFlags({ isCustom: true, protocol: 's7', canConfigureControl: false }).includeWriteMap).toBe(
            false,
        );
        expect(writeMapFormFlags({ isCustom: false, protocol: 's7', canConfigureControl: true }).includeWriteMap).toBe(
            false,
        );
    });
});

const machine = (overrides: Partial<Machine> = {}): Machine => ({
    id: 'm1',
    name: 'Shop Giesen',
    roasterKey: 'giesen_w6a',
    displayName: 'Giesen W6A',
    brand: 'Giesen',
    models: ['W6A'],
    protocol: 's7',
    connectionParams: {},
    capabilities: [],
    pid: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
});

describe('snapshotFromSidecar', () => {
    it('returns null when disconnected or missing roaster', () => {
        expect(snapshotFromSidecar({ connected: false, roaster: 'giesen_w6a' }, [machine()])).toBeNull();
        expect(snapshotFromSidecar({ connected: true, roaster: null }, [machine()])).toBeNull();
        expect(snapshotFromSidecar(null, [machine()])).toBeNull();
    });

    it('joins local machine for id/protocol and sidecar for name fallback', () => {
        expect(
            snapshotFromSidecar(
                { connected: true, roaster: 'giesen_w6a', display_name: 'Sidecar Name', brand: 'SidecarBrand' },
                [machine()],
            ),
        ).toEqual({
            machine_id: 'm1',
            machine_name: 'Shop Giesen',
            machine_roaster_key: 'giesen_w6a',
            machine_brand: 'Giesen',
            machine_protocol: 's7',
        });
    });

    it('keeps sidecar identity when the local machine was deleted', () => {
        expect(
            snapshotFromSidecar(
                { connected: true, roaster: 'giesen_w6a', display_name: 'Giesen W6A', brand: 'Giesen' },
                [],
            ),
        ).toEqual({
            machine_id: null,
            machine_name: 'Giesen W6A',
            machine_roaster_key: 'giesen_w6a',
            machine_brand: 'Giesen',
            machine_protocol: null,
        });
    });
});

describe('copyMachineSnapshot', () => {
    it('fills missing fields with null', () => {
        expect(copyMachineSnapshot(undefined)).toEqual(EMPTY_MACHINE_SNAPSHOT);
        expect(copyMachineSnapshot({ machine_name: 'A' })).toEqual({
            ...EMPTY_MACHINE_SNAPSHOT,
            machine_name: 'A',
        });
    });
});
