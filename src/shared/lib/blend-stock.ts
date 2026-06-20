export type BlendRoastableInput = {
    beanId: string;
    beanName: string;
    ratioPct: number;
    effectiveGrams: number;
};

export type BlendRoastableResult = {
    maxGrams: number;
    limitingBeanId: string | null;
    limitingBeanName: string | null;
    limitingEffectiveGrams: number;
};

export const EMPTY_BLEND_ROASTABLE: BlendRoastableResult = {
    maxGrams: 0,
    limitingBeanId: null,
    limitingBeanName: null,
    limitingEffectiveGrams: 0,
};

type BlendComponentStockSource = {
    bean_id: string;
    ratio_pct: number;
    beans: { name: string };
};

type BlendStockSource = {
    id: string;
    blend_components: BlendComponentStockSource[];
};

type StockSummaryLike = { effectiveGrams?: number };

/** Max green charge (g) roastable for a blend given per-component effective stock and ratios. */
export const blendMaxRoastableGrams = (components: BlendRoastableInput[]): BlendRoastableResult => {
    if (!components.length) {
        return EMPTY_BLEND_ROASTABLE;
    }

    let maxGrams = Infinity;
    let limitingBeanId: string | null = null;
    let limitingBeanName: string | null = null;
    let limitingEffectiveGrams = 0;

    for (const comp of components) {
        if (comp.ratioPct <= 0) {
            return EMPTY_BLEND_ROASTABLE;
        }
        const componentMax = Math.floor((comp.effectiveGrams * 100) / comp.ratioPct);
        if (componentMax < maxGrams) {
            maxGrams = componentMax;
            limitingBeanId = comp.beanId;
            limitingBeanName = comp.beanName;
            limitingEffectiveGrams = comp.effectiveGrams;
        }
    }

    if (!Number.isFinite(maxGrams) || maxGrams < 0) {
        return EMPTY_BLEND_ROASTABLE;
    }

    return { maxGrams, limitingBeanId, limitingBeanName, limitingEffectiveGrams };
};

export const blendToRoastableInputs = (
    blend: BlendStockSource,
    stockSummaries: Record<string, StockSummaryLike>,
): BlendRoastableInput[] =>
    blend.blend_components.map((c) => ({
        beanId: c.bean_id,
        beanName: c.beans.name,
        ratioPct: Number(c.ratio_pct),
        effectiveGrams: stockSummaries[c.bean_id]?.effectiveGrams ?? 0,
    }));

export const blendRoastableByBlends = (
    blends: BlendStockSource[],
    stockSummaries: Record<string, StockSummaryLike>,
): Record<string, BlendRoastableResult> =>
    Object.fromEntries(
        blends.map((blend) => [blend.id, blendMaxRoastableGrams(blendToRoastableInputs(blend, stockSummaries))]),
    );
