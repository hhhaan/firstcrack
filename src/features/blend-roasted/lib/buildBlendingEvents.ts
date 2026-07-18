import type { RoastedStockEventInsert } from '@entities/roasted-stock-event';

export type BuildBlendingEventsParams = {
    userId: string;
    blendId: string;
    /** 실제 투입량 — 레시피 비율은 프리필일 뿐, 여기 값이 진실 */
    inputs: { beanId: string; grams: number }[];
    /** 실측 산출량 — 투입 합계와 달라도 됨(핸들링 로스) */
    outputGrams: number;
    opId: string;
    note?: string;
};

/** 로스팅 후 블렌딩: 싱글 벌크 소진 + 블렌드 벌크 생성. 순수. */
export const buildBlendingEvents = ({
    userId,
    blendId,
    inputs,
    outputGrams,
    opId,
    note,
}: BuildBlendingEventsParams): RoastedStockEventInsert[] => {
    const active = inputs.filter((i) => i.grams > 0);
    if (active.length === 0) throw new Error('blending needs at least one input');
    if (outputGrams <= 0) throw new Error('output must be positive');

    return [
        ...active.map(
            (i): RoastedStockEventInsert => ({
                user_id: userId,
                bean_id: i.beanId,
                blend_id: null,
                delta_grams: -i.grams,
                event_type: 'blend_consume',
                reference_id: opId,
                note,
            }),
        ),
        {
            user_id: userId,
            bean_id: null,
            blend_id: blendId,
            delta_grams: outputGrams,
            event_type: 'blend_produce',
            reference_id: opId,
            note,
        },
    ];
};
