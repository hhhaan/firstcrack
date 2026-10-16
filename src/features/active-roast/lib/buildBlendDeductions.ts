export type BlendRatioSource = { bean_id: string; ratio_pct: number };

export type BlendDeduction = { beanId: string; grams: number };

/**
 * Distributes chargeGrams across blend components by ratio_pct.
 * Components are ordered by bean_id, matching save_roast_op.
 * The last bean_id absorbs the rounding remainder so the total equals chargeGrams.
 */
export const buildBlendDeductions = (chargeGrams: number, components: BlendRatioSource[]): BlendDeduction[] => {
    if (!components.length) return [];
    const ordered = [...components].sort((a, b) => {
        if (a.bean_id < b.bean_id) return -1;
        if (a.bean_id > b.bean_id) return 1;
        return 0;
    });
    let allocated = 0;
    return ordered.map((comp, i) => {
        const isLast = i === ordered.length - 1;
        const grams = isLast ? chargeGrams - allocated : Math.round(chargeGrams * (Number(comp.ratio_pct) / 100));
        allocated += grams;
        return { beanId: comp.bean_id, grams };
    });
};
