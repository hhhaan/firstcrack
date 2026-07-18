import { describe, expect, it } from 'vitest';
import { buildRoastedInbound } from './roastedInbound';

describe('buildRoastedInbound', () => {
    it('uses measured output when present', () => {
        expect(
            buildRoastedInbound({
                greenGrams: 10000,
                outputWeightGrams: 8400,
                roastLevel: 'Dark',
            }),
        ).toEqual({ grams: 8400, isEstimate: false });
    });

    it('estimates from roast level when unmeasured', () => {
        // Medium → 0.85
        expect(
            buildRoastedInbound({
                greenGrams: 10000,
                outputWeightGrams: null,
                roastLevel: 'Medium',
            }),
        ).toEqual({ grams: 8500, isEstimate: true });
    });

    it('skips when nothing to book', () => {
        expect(
            buildRoastedInbound({
                greenGrams: 0,
                outputWeightGrams: null,
                roastLevel: null,
            }),
        ).toBeNull();
        expect(
            buildRoastedInbound({
                greenGrams: 0,
                outputWeightGrams: 0,
                roastLevel: 'Dark',
            }),
        ).toBeNull();
    });
});
