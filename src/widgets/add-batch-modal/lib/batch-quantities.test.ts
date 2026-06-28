import { describe, expect, it } from 'vitest';
import { deriveBatchQuantities } from './batch-quantities';

describe('deriveBatchQuantities', () => {
    it('uses yield when computing batch count', () => {
        const { batchCount, greenNeededKg } = deriveBatchQuantities(10, 5, 82);
        expect(batchCount).toBe(3);
        expect(greenNeededKg).toBe(15);
    });

    it('returns zeros when target is empty', () => {
        const { batchCount, greenNeededKg, plannedGrams } = deriveBatchQuantities(0, 25, 82);
        expect(batchCount).toBe(0);
        expect(greenNeededKg).toBe(0);
        expect(plannedGrams).toBe(0);
    });
});
