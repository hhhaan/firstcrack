import { describe, expect, it } from 'vitest';
import { computeRoastWeights, DEFAULT_SHRINK_FACTOR } from './roastWeight';

describe('computeRoastWeights', () => {
    it('defaults null/undefined weight to zeros', () => {
        expect(computeRoastWeights(null)).toEqual({ outputKg: 0, inputKg: 0, lossRate: 0 });
        expect(computeRoastWeights(undefined)).toEqual({ outputKg: 0, inputKg: 0, lossRate: 0 });
    });

    it('derives green input from shrink factor', () => {
        // 820g roasted ≈ 1kg green at 0.82
        const w = computeRoastWeights(820);
        expect(w.outputKg).toBe(0.82);
        expect(w.inputKg).toBe(1);
        expect(w.lossRate).toBeCloseTo((1 - DEFAULT_SHRINK_FACTOR) * 100, 1);
    });

    it('rounds output/input to 3 decimals', () => {
        const w = computeRoastWeights(1234);
        expect(w.outputKg).toBe(1.234);
        expect(Number.isFinite(w.inputKg)).toBe(true);
        expect(String(w.inputKg).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
    });
});
