import { describe, expect, it } from 'vitest';
import {
    buildProtocolRoasterDef,
    buildTypedConnectionParams,
    copyMachineSnapshot,
    EMPTY_MACHINE_SNAPSHOT,
    isRoasterFieldVisible,
    snapshotFromSidecar,
    writeMapFormFlags,
} from './lib';
import type { Machine } from './types';

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

describe('buildTypedConnectionParams write map', () => {
    it('merges heater read channels onto BT/ET channels', () => {
        const def = buildProtocolRoasterDef('s7');
        const typed = buildTypedConnectionParams(
            def,
            {
                host: '192.168.1.10',
                bt_db: '3',
                bt_offset: '118',
                bt_type: '0',
                bt_div: '0',
                et_db: '',
                heater_w_db: '2',
                heater_w_offset: '14',
                heater_w_type: '0',
                heater_w_div: '0',
                heater_w_min: '0',
                heater_w_max: '100',
                heater_r_db: '2',
                heater_r_offset: '48',
                heater_r_type: '0',
                heater_r_div: '0',
                pid_kp: '20',
                pid_ki: '0.01',
                pid_kd: '3',
            },
            { includeAddressMap: true, includeWriteMap: true },
        );
        const channels = typed.channels as { role: string }[];
        expect(channels.map((c) => c.role)).toEqual(['BT', 'heater']);
        expect(typed.write_map).toEqual({
            heater: { db: 2, offset: 14, area: 6, type: 0, div: 0, min: 0, max: 100, unit: '%' },
        });
        expect(typed.pid).toEqual({ Kp: 20, Ki: 0.01, Kd: 3 });
        expect(typed).not.toHaveProperty('control_channels');
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
