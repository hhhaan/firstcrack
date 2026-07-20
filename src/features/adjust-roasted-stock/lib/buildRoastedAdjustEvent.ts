import type { RoastedStockEventInsert } from '@entities/roasted-stock-event';

export type RoastedAdjustParams = {
    userId: string;
    beanId: string | null;
    blendId: string | null;
    type: 'adjustment' | 'write_off';
    /** write_off는 무시되고 항상 차감 */
    sign: '+' | '-';
    /** 양수 크기 (g) */
    grams: number;
    note: string;
    /** 클라 생성 uuid — partial unique 인덱스로 이중 제출 방지 */
    referenceId: string;
};

/** 벌크 원두 수동 조정/폐기 이벤트 1건. Pure — API/캐시 부수효과 없음. */
export const buildRoastedAdjustEvent = (p: RoastedAdjustParams): RoastedStockEventInsert | null => {
    if (p.grams <= 0) return null;
    if (!p.beanId && !p.blendId) return null;
    const negative = p.type === 'write_off' || p.sign === '-';
    return {
        user_id: p.userId,
        bean_id: p.blendId ? null : p.beanId,
        blend_id: p.blendId ?? null,
        delta_grams: negative ? -p.grams : p.grams,
        event_type: p.type,
        reference_id: p.referenceId,
        note: p.note.trim() || null,
    };
};
