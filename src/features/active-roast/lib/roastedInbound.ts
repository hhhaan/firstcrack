import { shrinkFactorForLevel } from '@shared/lib/roastWeight';

export type RoastedInboundPlan = {
    grams: number;
    isEstimate: boolean;
    beanId: string | null;
    blendId: string | null;
};

/** 세션 → 벌크 원두 입고량. 실측 우선, 없으면 레벨 기반 추정. null = 입고할 것 없음. */
export const buildRoastedInbound = (p: {
    greenGrams: number;
    outputWeightGrams: number | null;
    roastLevel: string | null;
    beanId: string | null;
    blendId: string | null;
}): RoastedInboundPlan | null => {
    if (!p.beanId && !p.blendId) return null;
    const measured = p.outputWeightGrams != null && p.outputWeightGrams > 0;
    const grams = measured
        ? (p.outputWeightGrams as number)
        : Math.round(p.greenGrams * shrinkFactorForLevel(p.roastLevel));
    if (grams <= 0) return null;
    return { grams, isEstimate: !measured, beanId: p.blendId ? null : p.beanId, blendId: p.blendId };
};
