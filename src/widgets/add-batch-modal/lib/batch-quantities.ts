import { batchGreenNeededGrams, calcPlanBatchCount } from '@shared/lib/stock-calc';

export const deriveBatchQuantities = (targetRoastedKg: number, batchSizeKg: number, yieldPct: number) => {
    const yieldFraction = yieldPct / 100;
    const batchCount =
        targetRoastedKg > 0 && batchSizeKg > 0 ? calcPlanBatchCount(targetRoastedKg, batchSizeKg, yieldFraction) : 0;
    const greenNeededKg =
        batchCount > 0 && batchSizeKg > 0
            ? Math.round((batchGreenNeededGrams(batchCount, 0, batchSizeKg) / 1000) * 10) / 10
            : 0;
    const plannedGrams = batchSizeKg * batchCount * 1000;

    return { batchCount, greenNeededKg, plannedGrams, yieldFraction };
};
