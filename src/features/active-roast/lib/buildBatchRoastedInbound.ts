import type { RoastedStockEventInsert } from '@entities/roasted-stock-event';
import { shrinkFactorForLevel } from '@shared/lib/roastWeight';

/**
 * 배치 일괄 완료 → 벌크 원두 추정 입고 1건. 실측이 없는 경로라 항상 is_estimate.
 * 생두 차감(remaining grams)과 같은 양을 기준으로 수축률만 적용 — 세션별 저장분은
 * 이미 자기 입고를 썼으므로 여기선 남은 세션분만 커버된다 (green 차감과 대칭).
 */
export const buildBatchRoastedInbound = (p: {
    userId: string;
    deductionGrams: number;
    beanId: string | null;
    blendId: string | null;
    /** plan_batch.id — roast_inbound partial unique로 멱등 */
    referenceId: string;
    roastLevel?: string | null;
}): RoastedStockEventInsert | null => {
    if (p.deductionGrams <= 0) return null;
    if (!p.beanId && !p.blendId) return null;
    const grams = Math.round(p.deductionGrams * shrinkFactorForLevel(p.roastLevel ?? null));
    if (grams <= 0) return null;
    return {
        user_id: p.userId,
        bean_id: p.blendId ? null : p.beanId,
        blend_id: p.blendId ?? null,
        delta_grams: grams,
        event_type: 'roast_inbound',
        reference_id: p.referenceId,
        is_estimate: true,
    };
};
