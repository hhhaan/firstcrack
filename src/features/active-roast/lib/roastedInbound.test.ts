import { describe, expect, it } from 'vitest';
import { buildRoastedInbound } from './roastedInbound';

describe('buildRoastedInbound', () => {
    it('uses measured output when present', () => {
        expect(
            buildRoastedInbound({
                greenGrams: 10000,
                outputWeightGrams: 8400,
                roastLevel: 'Dark',
                beanId: 'b1',
                blendId: null,
            }),
        ).toEqual({ grams: 8400, isEstimate: false, beanId: 'b1', blendId: null });
    });

    it('estimates from roast level when unmeasured', () => {
        // Medium → 0.85
        expect(
            buildRoastedInbound({
                greenGrams: 10000,
                outputWeightGrams: null,
                roastLevel: 'Medium',
                beanId: null,
                blendId: 'x1',
            }),
        ).toEqual({ grams: 8500, isEstimate: true, beanId: null, blendId: 'x1' });
    });

    it('skips when nothing to book', () => {
        expect(
            buildRoastedInbound({
                greenGrams: 0,
                outputWeightGrams: null,
                roastLevel: null,
                beanId: 'b1',
                blendId: null,
            }),
        ).toBeNull();
        expect(
            buildRoastedInbound({
                greenGrams: 1000,
                outputWeightGrams: null,
                roastLevel: null,
                beanId: null,
                blendId: null,
            }),
        ).toBeNull();
    });
});
