import { describe, expect, it } from 'vitest';
import { isRoasterFieldVisible, writeMapFormFlags } from './lib';

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
