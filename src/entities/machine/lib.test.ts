import { describe, expect, it } from 'vitest';
import { isRoasterFieldVisible } from './lib';

describe('isRoasterFieldVisible', () => {
    it.each(['rtu', 'ascii', 'serial'])('serial mode %s hides TCP fields, shows serial fields', (mode) => {
        expect(isRoasterFieldVisible('host', mode)).toBe(false);
        expect(isRoasterFieldVisible('port', mode)).toBe(false);
        expect(isRoasterFieldVisible('comport', mode)).toBe(true);
        expect(isRoasterFieldVisible('baudrate', mode)).toBe(true);
    });

    it('tcp mode hides serial fields, shows TCP fields', () => {
        expect(isRoasterFieldVisible('host', 'tcp')).toBe(true);
        expect(isRoasterFieldVisible('comport', 'tcp')).toBe(false);
        expect(isRoasterFieldVisible('baudrate', 'tcp')).toBe(false);
    });

    it('unknown/empty mode shows everything', () => {
        expect(isRoasterFieldVisible('host', undefined)).toBe(true);
        expect(isRoasterFieldVisible('comport', '')).toBe(true);
    });
});
