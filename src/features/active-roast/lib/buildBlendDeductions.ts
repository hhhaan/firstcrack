import type { BlendComponent } from '@entities/blend';

export type BlendDeduction = { beanId: string; grams: number };

/**
 * Distributes chargeGrams across blend components by ratio_pct.
 * Last component absorbs rounding remainder so total always equals chargeGrams.
 */
export const buildBlendDeductions = (chargeGrams: number, components: BlendComponent[]): BlendDeduction[] => {
    if (!components.length) return [];
    let allocated = 0;
    return components.map((comp, i) => {
        const isLast = i === components.length - 1;
        const grams = isLast ? chargeGrams - allocated : Math.round(chargeGrams * (Number(comp.ratio_pct) / 100));
        allocated += grams;
        return { beanId: comp.bean_id, grams };
    });
};
