import { describe, expect, it } from 'vitest';
import { buildProductAdjustEvent } from './buildProductAdjustEvent';

const base = {
    userId: 'u1',
    productId: 'p1',
    type: 'adjustment' as const,
    sign: '+' as const,
    units: 12,
    note: '파손 반영',
    referenceId: 'ref-1',
};

describe('buildProductAdjustEvent', () => {
    it('positive adjustment', () => {
        expect(buildProductAdjustEvent(base)).toEqual({
            user_id: 'u1',
            product_id: 'p1',
            delta_units: 12,
            event_type: 'adjustment',
            reference_id: 'ref-1',
            note: '파손 반영',
        });
    });

    it('negative adjustment / write_off always negative', () => {
        expect(buildProductAdjustEvent({ ...base, sign: '-' })?.delta_units).toBe(-12);
        expect(buildProductAdjustEvent({ ...base, type: 'write_off', sign: '+' })?.delta_units).toBe(-12);
    });

    it('null when no amount', () => {
        expect(buildProductAdjustEvent({ ...base, units: 0 })).toBeNull();
    });
});
