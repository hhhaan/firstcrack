import { describe, expect, it } from 'vitest';
import {
    buildGreenInventoryAssets,
    calcBeanAssetLine,
    calcPurchaseWeightedAvgCost,
    resolveUnitCost,
    sumGreenInventoryAssets,
} from './asset-value';

describe('calcPurchaseWeightedAvgCost', () => {
    it('single purchase', () => {
        expect(calcPurchaseWeightedAvgCost([{ delta_grams: 10_000, cost_per_kg: 10_000 }])).toBe(10_000);
    });

    it('two purchases weight by grams', () => {
        expect(
            calcPurchaseWeightedAvgCost([
                { delta_grams: 5_000, cost_per_kg: 10_000 },
                { delta_grams: 5_000, cost_per_kg: 20_000 },
            ]),
        ).toBe(15_000);
    });

    it('returns null when no valid grams', () => {
        expect(calcPurchaseWeightedAvgCost([])).toBeNull();
        expect(calcPurchaseWeightedAvgCost([{ delta_grams: 0, cost_per_kg: 10_000 }])).toBeNull();
        expect(calcPurchaseWeightedAvgCost([{ delta_grams: -100, cost_per_kg: 10_000 }])).toBeNull();
    });
});

describe('resolveUnitCost', () => {
    it('prefers WAC over master', () => {
        expect(resolveUnitCost(12_000, 9_000)).toEqual({ unitCostPerKg: 12_000, costSource: 'wac' });
    });

    it('falls back to master', () => {
        expect(resolveUnitCost(null, 9_000)).toEqual({ unitCostPerKg: 9_000, costSource: 'master' });
    });

    it('none when both missing', () => {
        expect(resolveUnitCost(null, null)).toEqual({ unitCostPerKg: null, costSource: 'none' });
    });
});

describe('calcBeanAssetLine', () => {
    it('WAC asset for stock', () => {
        const line = calcBeanAssetLine('b1', 10_000, 10_000, null);
        expect(line.assetValue).toBe(100_000);
        expect(line.costSource).toBe('wac');
        expect(line.valuedGrams).toBe(10_000);
    });

    it('two-purchase avg via buildGreenInventoryAssets', () => {
        const summary = buildGreenInventoryAssets([{ id: 'b1', cost_per_kg: null }], { b1: { currentGrams: 10_000 } }, [
            { bean_id: 'b1', delta_grams: 5_000, cost_per_kg: 10_000 },
            { bean_id: 'b1', delta_grams: 5_000, cost_per_kg: 20_000 },
        ]);
        expect(summary.byBeanId.b1.unitCostPerKg).toBe(15_000);
        expect(summary.byBeanId.b1.assetValue).toBe(150_000);
        expect(summary.totalAssetValue).toBe(150_000);
    });

    it('zero stock with cost is not unevaluated', () => {
        const line = calcBeanAssetLine('b1', 0, 10_000, null);
        expect(line.assetValue).toBe(0);
        expect(line.costSource).toBe('wac');
        const summary = sumGreenInventoryAssets([line]);
        expect(summary.unevaluatedCount).toBe(0);
        expect(summary.evaluatedCount).toBe(0);
    });

    it('master fallback when no WAC', () => {
        const line = calcBeanAssetLine('b1', 2_000, null, 8_000);
        expect(line.costSource).toBe('master');
        expect(line.assetValue).toBe(16_000);
    });

    it('unevaluated when stock > 0 and no cost', () => {
        const line = calcBeanAssetLine('b1', 1_000, null, null);
        expect(line.costSource).toBe('none');
        expect(line.assetValue).toBeNull();
        expect(sumGreenInventoryAssets([line]).unevaluatedCount).toBe(1);
    });

    it('negative stock valued at 0 grams', () => {
        const line = calcBeanAssetLine('b1', -500, 10_000, null);
        expect(line.valuedGrams).toBe(0);
        expect(line.assetValue).toBe(0);
    });

    it('total excludes unevaluated', () => {
        const summary = sumGreenInventoryAssets([
            calcBeanAssetLine('a', 10_000, 10_000, null),
            calcBeanAssetLine('b', 5_000, null, null),
        ]);
        expect(summary.totalAssetValue).toBe(100_000);
        expect(summary.unevaluatedCount).toBe(1);
        expect(summary.evaluatedCount).toBe(1);
    });
});
