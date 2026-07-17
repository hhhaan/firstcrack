import { describe, expect, it } from 'vitest';
import { CARRIER_OPTIONS } from '../../../../src/shared/lib/carriers.ts';
import { CARRIERS, carrierIds, isCarrierId, platformCarrierCode } from './carriers.ts';

const PLATFORMS = ['naver', 'cafe24', 'shopify'] as const;

describe('carriers', () => {
    it('every CarrierId × platform returns non-empty string', () => {
        for (const id of carrierIds()) {
            for (const p of PLATFORMS) {
                const code = platformCarrierCode(id, p);
                expect(code.length).toBeGreaterThan(0);
            }
        }
    });

    it('unknown carrier throws', () => {
        expect(() => platformCarrierCode('nope' as never, 'naver')).toThrow(/unknown carrier/);
    });

    it('isCarrierId', () => {
        expect(isCarrierId('cj')).toBe(true);
        expect(isCarrierId('nope')).toBe(false);
    });

    it('client CARRIER_OPTIONS ids match EF CARRIERS keys (no drift)', () => {
        const clientIds = CARRIER_OPTIONS.map((c) => c.id).sort();
        const efIds = Object.keys(CARRIERS).sort();
        expect(clientIds).toEqual(efIds);
    });
});
