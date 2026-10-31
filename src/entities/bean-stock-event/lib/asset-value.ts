export type CostSource = 'wac' | 'master' | 'none';

export type PurchaseCostEvent = {
    bean_id: string;
    delta_grams: number;
    cost_per_kg: number;
};

export type BeanAssetLine = {
    beanId: string;
    currentGrams: number;
    valuedGrams: number;
    unitCostPerKg: number | null;
    costSource: CostSource;
    assetValue: number | null;
};

export type GreenInventoryAssetSummary = {
    lines: BeanAssetLine[];
    /** beanId → line for O(1) row lookup */
    byBeanId: Record<string, BeanAssetLine>;
    totalAssetValue: number;
    unevaluatedCount: number;
    evaluatedCount: number;
};

export const calcPurchaseWeightedAvgCost = (events: { delta_grams: number; cost_per_kg: number }[]): number | null => {
    let weightedSum = 0;
    let totalGrams = 0;
    for (const e of events) {
        if (!(e.delta_grams > 0) || !Number.isFinite(e.cost_per_kg)) continue;
        weightedSum += e.delta_grams * e.cost_per_kg;
        totalGrams += e.delta_grams;
    }
    if (totalGrams <= 0) return null;
    return weightedSum / totalGrams;
};

export const buildWacByBeanId = (events: PurchaseCostEvent[]): Record<string, number> => {
    const byBean = new Map<string, { delta_grams: number; cost_per_kg: number }[]>();
    for (const e of events) {
        if (!(e.delta_grams > 0) || !Number.isFinite(e.cost_per_kg)) continue;
        const list = byBean.get(e.bean_id);
        if (list) list.push(e);
        else byBean.set(e.bean_id, [e]);
    }
    const out: Record<string, number> = {};
    for (const [beanId, list] of byBean) {
        const wac = calcPurchaseWeightedAvgCost(list);
        if (wac != null) out[beanId] = wac;
    }
    return out;
};

export const resolveUnitCost = (
    wac: number | null,
    masterCostPerKg: number | null,
): { unitCostPerKg: number | null; costSource: CostSource } => {
    if (wac != null && Number.isFinite(wac)) {
        return { unitCostPerKg: wac, costSource: 'wac' };
    }
    if (masterCostPerKg != null && Number.isFinite(masterCostPerKg)) {
        return { unitCostPerKg: masterCostPerKg, costSource: 'master' };
    }
    return { unitCostPerKg: null, costSource: 'none' };
};

export const calcInventoryAsset = (grams: number, unitCostPerKg: number): number => (grams / 1000) * unitCostPerKg;

export const calcBeanAssetLine = (
    beanId: string,
    currentGrams: number,
    wac: number | null,
    masterCostPerKg: number | null,
): BeanAssetLine => {
    const valuedGrams = Math.max(0, currentGrams);
    const { unitCostPerKg, costSource } = resolveUnitCost(wac, masterCostPerKg);
    const assetValue = unitCostPerKg != null ? calcInventoryAsset(valuedGrams, unitCostPerKg) : null;
    return {
        beanId,
        currentGrams,
        valuedGrams,
        unitCostPerKg,
        costSource,
        assetValue,
    };
};

export const sumGreenInventoryAssets = (lines: BeanAssetLine[]): GreenInventoryAssetSummary => {
    let totalAssetValue = 0;
    let unevaluatedCount = 0;
    let evaluatedCount = 0;
    const byBeanId: Record<string, BeanAssetLine> = {};

    for (const line of lines) {
        byBeanId[line.beanId] = line;
        if (line.assetValue != null) {
            totalAssetValue += line.assetValue;
            if (line.valuedGrams > 0) evaluatedCount += 1;
        } else if (line.valuedGrams > 0 && line.costSource === 'none') {
            unevaluatedCount += 1;
        }
    }

    return {
        lines,
        byBeanId,
        totalAssetValue,
        unevaluatedCount,
        evaluatedCount,
    };
};

export const buildGreenInventoryAssetsFromWac = (
    beans: { id: string; cost_per_kg: number | null }[],
    stockByBeanId: Record<string, { currentGrams: number } | undefined>,
    wacByBean: Record<string, number>,
): GreenInventoryAssetSummary => {
    const lines = beans.map((b) =>
        calcBeanAssetLine(b.id, stockByBeanId[b.id]?.currentGrams ?? 0, wacByBean[b.id] ?? null, b.cost_per_kg),
    );
    return sumGreenInventoryAssets(lines);
};

export const buildGreenInventoryAssets = (
    beans: { id: string; cost_per_kg: number | null }[],
    stockByBeanId: Record<string, { currentGrams: number } | undefined>,
    purchaseEvents: PurchaseCostEvent[],
): GreenInventoryAssetSummary => {
    const wacByBean = buildWacByBeanId(purchaseEvents);
    const lines = beans.map((b) =>
        calcBeanAssetLine(b.id, stockByBeanId[b.id]?.currentGrams ?? 0, wacByBean[b.id] ?? null, b.cost_per_kg),
    );
    return sumGreenInventoryAssets(lines);
};
