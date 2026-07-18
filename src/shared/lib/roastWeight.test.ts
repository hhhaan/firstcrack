import { describe, expect, it } from 'vitest';
import { computeRoastWeights, DEFAULT_SHRINK_FACTOR } from './roastWeight';

describe('computeRoastWeights', () => {
    it('defaults null/undefined green weight to zeros', () => {
        expect(computeRoastWeights(null)).toEqual({ outputKg: 0, inputKg: 0, lossRate: 0, measured: false });
        expect(computeRoastWeights(undefined)).toEqual({ outputKg: 0, inputKg: 0, lossRate: 0, measured: false });
    });

    it('uses measured output for a real loss rate', () => {
        // 10kg green in, 8.4kg out → 16% loss (not the 18% estimate)
        const w = computeRoastWeights(10000, 8400);
        expect(w.inputKg).toBe(10);
        expect(w.outputKg).toBe(8.4);
        expect(w.lossRate).toBe(16);
        expect(w.measured).toBe(true);
    });

    it('estimates output via shrink factor when unmeasured', () => {
        const w = computeRoastWeights(1000);
        expect(w.inputKg).toBe(1);
        expect(w.outputKg).toBe(DEFAULT_SHRINK_FACTOR);
        expect(w.lossRate).toBeCloseTo((1 - DEFAULT_SHRINK_FACTOR) * 100, 1);
        expect(w.measured).toBe(false);
    });

    it('scales the estimate by roast level', () => {
        expect(computeRoastWeights(1000, null, 'Light').lossRate).toBe(12);
        expect(computeRoastWeights(1000, null, 'Medium').lossRate).toBe(15);
        expect(computeRoastWeights(1000, null, 'Dark').lossRate).toBe(18);
        // unknown level → default factor
        expect(computeRoastWeights(1000, null, 'Espresso').lossRate).toBe(18);
        // measured output wins over the level estimate
        expect(computeRoastWeights(1000, 900, 'Dark').lossRate).toBe(10);
    });

    it('treats zero output as unmeasured rather than 100% loss', () => {
        expect(computeRoastWeights(1000, 0).measured).toBe(false);
        expect(computeRoastWeights(1000, 0).outputKg).toBe(DEFAULT_SHRINK_FACTOR);
    });

    it('rounds kg to 3 decimals', () => {
        const w = computeRoastWeights(1234, 1000);
        expect(w.inputKg).toBe(1.234);
        expect(w.outputKg).toBe(1);
    });
});
