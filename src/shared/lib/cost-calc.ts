import { DEFAULT_SHRINK_FACTOR } from './roastWeight';

export const DEFAULT_YIELD_PCT = DEFAULT_SHRINK_FACTOR * 100;

export type BlendCostComponent = {
    ratioPct: number;
    costPerKg: number | null;
};

export const blendGreenCostPerKg = (components: BlendCostComponent[]): number => {
    const active = components.filter((c) => c.ratioPct > 0);
    const totalRatio = active.reduce((sum, c) => sum + c.ratioPct, 0);
    if (totalRatio <= 0) return 0;

    const weighted = active.reduce((sum, c) => sum + c.ratioPct * (c.costPerKg ?? 0), 0);
    return weighted / totalRatio;
};

export const roastedCostPerKg = (greenCostPerKg: number, yieldPct: number): number => {
    if (greenCostPerKg <= 0 || yieldPct <= 0) return 0;
    return greenCostPerKg / (yieldPct / 100);
};

export const totalCostPerKg = (roastedCostKg: number, overheadPerKg: number): number =>
    Math.max(0, roastedCostKg + Math.max(0, overheadPerKg));

export const sumOverheadPerKg = (items: { amountPerKg: number }[]): number =>
    items.reduce((sum, i) => sum + Math.max(0, i.amountPerKg || 0), 0);

export const sellingPriceFromMargin = (costPerKg: number, marginPct: number): number => {
    if (costPerKg <= 0) return 0;
    const marginRate = marginPct / 100;
    if (marginRate >= 1) return 0;
    if (marginRate <= 0) return costPerKg;
    return costPerKg / (1 - marginRate);
};

export const marginFromSellingPrice = (costPerKg: number, sellingPrice: number): number => {
    if (sellingPrice <= 0 || costPerKg <= 0) return 0;
    if (sellingPrice <= costPerKg) return 0;
    return ((sellingPrice - costPerKg) / sellingPrice) * 100;
};

export const profitPerKg = (sellingPrice: number, costPerKg: number): number => Math.max(0, sellingPrice - costPerKg);
