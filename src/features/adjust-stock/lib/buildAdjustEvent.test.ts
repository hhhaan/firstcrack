import { describe, expect, it } from 'vitest';
import { buildProductAdjustEvent } from './buildProductAdjustEvent';
import { buildRoastedAdjustEvent } from './buildRoastedAdjustEvent';
import { signedDelta, trimNote } from './signedDelta';

describe('signedDelta', () => {
    it('positive / negative / write_off always negative', () => {
        expect(signedDelta('adjustment', '+', 12)).toBe(12);
        expect(signedDelta('adjustment', '-', 12)).toBe(-12);
        expect(signedDelta('write_off', '+', 12)).toBe(-12);
    });

    it('null when amount ≤ 0', () => {
        expect(signedDelta('adjustment', '+', 0)).toBeNull();
        expect(signedDelta('adjustment', '+', -1)).toBeNull();
    });
});

describe('trimNote', () => {
    it('trims or null', () => {
        expect(trimNote('  x  ')).toBe('x');
        expect(trimNote('  ')).toBeNull();
    });
});

const productBase = {
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
        expect(buildProductAdjustEvent(productBase)).toEqual({
            user_id: 'u1',
            product_id: 'p1',
            delta_units: 12,
            event_type: 'adjustment',
            reference_id: 'ref-1',
            note: '파손 반영',
        });
    });

    it('negative adjustment / write_off always negative', () => {
        expect(buildProductAdjustEvent({ ...productBase, sign: '-' })?.delta_units).toBe(-12);
        expect(buildProductAdjustEvent({ ...productBase, type: 'write_off', sign: '+' })?.delta_units).toBe(-12);
    });

    it('null when no amount', () => {
        expect(buildProductAdjustEvent({ ...productBase, units: 0 })).toBeNull();
    });
});

const roastedBase = {
    userId: 'u1',
    beanId: 'bean-1',
    blendId: null,
    type: 'adjustment' as const,
    sign: '+' as const,
    grams: 500,
    note: '실사 보정',
    referenceId: 'ref-1',
};

describe('buildRoastedAdjustEvent', () => {
    it('positive adjustment', () => {
        expect(buildRoastedAdjustEvent(roastedBase)).toEqual({
            user_id: 'u1',
            bean_id: 'bean-1',
            blend_id: null,
            delta_grams: 500,
            event_type: 'adjustment',
            reference_id: 'ref-1',
            note: '실사 보정',
        });
    });

    it('negative / write_off', () => {
        expect(buildRoastedAdjustEvent({ ...roastedBase, sign: '-' })?.delta_grams).toBe(-500);
        expect(buildRoastedAdjustEvent({ ...roastedBase, type: 'write_off', sign: '+' })?.delta_grams).toBe(-500);
        expect(buildRoastedAdjustEvent({ ...roastedBase, type: 'write_off', sign: '+' })?.event_type).toBe('write_off');
    });

    it('blend target zeroes bean_id', () => {
        const e = buildRoastedAdjustEvent({ ...roastedBase, beanId: null, blendId: 'blend-1' });
        expect(e?.blend_id).toBe('blend-1');
        expect(e?.bean_id).toBeNull();
    });

    it('null when no amount or no target', () => {
        expect(buildRoastedAdjustEvent({ ...roastedBase, grams: 0 })).toBeNull();
        expect(buildRoastedAdjustEvent({ ...roastedBase, beanId: null })).toBeNull();
    });

    it('empty note becomes null', () => {
        expect(buildRoastedAdjustEvent({ ...roastedBase, note: '  ' })?.note).toBeNull();
    });
});
