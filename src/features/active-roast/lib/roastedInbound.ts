import { shrinkFactorForLevel } from '@shared/lib/roastWeight';

/**
 * 세션 → 벌크 원두 입고량. 실측 우선, 없으면 레벨 기반 추정. null = 입고할 것 없음.
 * bean/blend 귀속은 서버(`upsert_roasted_inbound`)가 세션에서 해석한다.
 */
export const buildRoastedInbound = (p: {
    greenGrams: number;
    outputWeightGrams: number | null;
    roastLevel: string | null;
}): { grams: number; isEstimate: boolean } | null => {
    const measured = p.outputWeightGrams != null && p.outputWeightGrams > 0;
    const grams = measured
        ? (p.outputWeightGrams as number)
        : Math.round(p.greenGrams * shrinkFactorForLevel(p.roastLevel));
    if (grams <= 0) return null;
    return { grams, isEstimate: !measured };
};
