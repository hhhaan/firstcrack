import { describe, expect, it } from 'vitest';
import {
    blendGreenCostPerKg,
    DEFAULT_YIELD_PCT,
    marginFromSellingPrice,
    profitPerKg,
    roastedCostPerKg,
    sellingPriceFromMargin,
    sumOverheadPerKg,
    totalCostPerKg,
} from './cost-calc';

describe('DEFAULT_YIELD_PCT', () => {
    it('matches shrink factor', () => {
        expect(DEFAULT_YIELD_PCT).toBe(82);
    });
});

describe('blendGreenCostPerKg', () => {
    it('computes ratio-weighted average', () => {
        expect(
            blendGreenCostPerKg([
                { ratioPct: 60, costPerKg: 30000 },
                { ratioPct: 40, costPerKg: 20000 },
            ]),
        ).toBe(26000);
    });

    it('normalizes when ratios do not sum to 100', () => {
        expect(
            blendGreenCostPerKg([
                { ratioPct: 3, costPerKg: 30000 },
                { ratioPct: 2, costPerKg: 20000 },
            ]),
        ).toBe(26000);
    });

    it('treats null cost as zero', () => {
        expect(blendGreenCostPerKg([{ ratioPct: 50, costPerKg: null }])).toBe(0);
    });

    it('returns 0 for empty or zero ratios', () => {
        expect(blendGreenCostPerKg([])).toBe(0);
        expect(blendGreenCostPerKg([{ ratioPct: 0, costPerKg: 10000 }])).toBe(0);
    });
});

describe('roastedCostPerKg', () => {
    it('applies yield to green cost', () => {
        expect(roastedCostPerKg(8200, 82)).toBeCloseTo(10000);
    });

    it('returns 0 for invalid inputs', () => {
        expect(roastedCostPerKg(0, 82)).toBe(0);
        expect(roastedCostPerKg(10000, 0)).toBe(0);
    });
});

describe('totalCostPerKg', () => {
    it('adds overhead', () => {
        expect(totalCostPerKg(10000, 500)).toBe(10500);
    });

    it('ignores negative overhead', () => {
        expect(totalCostPerKg(10000, -100)).toBe(10000);
    });
});

describe('sumOverheadPerKg', () => {
    it('sums amounts', () => {
        expect(sumOverheadPerKg([{ amountPerKg: 1200 }, { amountPerKg: 800 }])).toBe(2000);
    });

    it('clamps negatives and empty', () => {
        expect(sumOverheadPerKg([])).toBe(0);
        expect(sumOverheadPerKg([{ amountPerKg: -50 }, { amountPerKg: 100 }])).toBe(100);
    });
});

describe('sellingPriceFromMargin', () => {
    it('computes gross margin price', () => {
        expect(sellingPriceFromMargin(6000, 40)).toBeCloseTo(10000);
    });

    it('returns cost when margin is 0', () => {
        expect(sellingPriceFromMargin(8000, 0)).toBe(8000);
    });

    it('calculates selling price for a 79% margin', () => {
        expect(sellingPriceFromMargin(10000, 79)).toBeCloseTo(47619.05, 0);
    });

    it('returns 0 for invalid margin >= 100', () => {
        expect(sellingPriceFromMargin(10000, 100)).toBe(0);
    });

    it('returns 0 when cost is 0', () => {
        expect(sellingPriceFromMargin(0, 40)).toBe(0);
    });
});

describe('marginFromSellingPrice', () => {
    it('reverses gross margin', () => {
        expect(marginFromSellingPrice(6000, 10000)).toBeCloseTo(40);
    });

    it('returns 0 when price does not exceed cost', () => {
        expect(marginFromSellingPrice(10000, 10000)).toBe(0);
        expect(marginFromSellingPrice(10000, 8000)).toBe(0);
    });

    it('returns 0 for invalid inputs', () => {
        expect(marginFromSellingPrice(0, 10000)).toBe(0);
        expect(marginFromSellingPrice(5000, 0)).toBe(0);
    });
});

describe('profitPerKg', () => {
    it('computes profit', () => {
        expect(profitPerKg(10000, 6000)).toBe(4000);
    });

    it('never returns negative', () => {
        expect(profitPerKg(5000, 6000)).toBe(0);
    });
});
