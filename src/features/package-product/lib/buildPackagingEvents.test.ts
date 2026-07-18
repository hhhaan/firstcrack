import { describe, expect, it } from 'vitest';
import { buildPackagingEvents } from './buildPackagingEvents';

const base = { userId: 'u1', productId: 'p1', units: 10, netWeightGrams: 200, opId: 'op1' };

describe('buildPackagingEvents', () => {
    it('pairs product inbound with roasted packaging deduction', () => {
        const { productEvents, roastedEvents } = buildPackagingEvents({ ...base, beanId: 'b1', blendId: null });
        expect(productEvents).toEqual([
            {
                user_id: 'u1',
                product_id: 'p1',
                delta_units: 10,
                event_type: 'roast_inbound',
                reference_id: 'op1',
                note: undefined,
            },
        ]);
        expect(roastedEvents).toEqual([
            {
                user_id: 'u1',
                bean_id: 'b1',
                blend_id: null,
                delta_grams: -2000,
                event_type: 'packaging',
                reference_id: 'op1',
                note: undefined,
            },
        ]);
    });

    it('attributes blend products to blend_id', () => {
        const { roastedEvents } = buildPackagingEvents({ ...base, beanId: null, blendId: 'x1' });
        expect(roastedEvents[0]).toMatchObject({ bean_id: null, blend_id: 'x1', delta_grams: -2000 });
    });

    it('skips roasted deduction for non-coffee products (merch)', () => {
        const { productEvents, roastedEvents } = buildPackagingEvents({ ...base, beanId: null, blendId: null });
        expect(productEvents).toHaveLength(1);
        expect(roastedEvents).toHaveLength(0);
    });

    it('rejects non-positive units', () => {
        expect(() => buildPackagingEvents({ ...base, units: 0, beanId: 'b1', blendId: null })).toThrow();
    });
});
