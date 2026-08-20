import { describe, expect, it } from 'vitest';
import {
    controlCapabilitiesFromParams,
    isRoasterFieldVisible,
    writeDisplayRoles,
    writeMapFormFlags,
    writeRolesFromControl,
    writeRolesFromStatus,
} from './lib';

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

describe('controlCapabilitiesFromParams', () => {
    it('uses write_map keys only — read-only channels are not writable', () => {
        expect(
            controlCapabilitiesFromParams({
                write_map: { heater: { db: 2 } },
                channels: [{ role: 'BT' }, { role: 'fan', db: 2, offset: 10 }, { role: 'heater', db: 2, offset: 48 }],
            }),
        ).toEqual(['heater']);
    });

    it('does not treat registry capabilities as writable', () => {
        expect(controlCapabilitiesFromParams({ host: '172.30.30.50' })).toEqual([]);
    });
});

describe('write roles from /status.control', () => {
    it('ignores registry capabilities when control is heater-only', () => {
        expect(
            writeRolesFromStatus({
                control: { writable: true, limits: { heater: { min: 0, max: 100 } } },
            }),
        ).toEqual(['heater']);
        expect(writeRolesFromControl({ writable: true, limits: { heater: { min: 0, max: 100 } } })).toEqual(['heater']);
    });

    it('writeDisplayRoles prefers live control over params, never registry caps', () => {
        expect(writeDisplayRoles({ host: 'x' })).toEqual([]);
        expect(writeDisplayRoles({ host: 'x', write_map: { heater: { db: 2 } } }, undefined)).toEqual(['heater']);
        expect(
            writeDisplayRoles(
                { write_map: { heater: { db: 2 }, fan: { db: 2 } } },
                { writable: true, limits: { heater: { min: 0, max: 100 } } },
            ),
        ).toEqual(['heater']);
    });
});
