import type { ProductStockEventInsert } from '@entities/product-stock-event';
import type { RoastedStockEventInsert } from '@entities/roasted-stock-event';

export type BuildPackagingEventsParams = {
    userId: string;
    productId: string;
    units: number;
    netWeightGrams: number;
    beanId: string | null;
    blendId: string | null;
    /** 작업 단위 uuid — product/roasted 양쪽 원장을 잇는 키 */
    opId: string;
    note?: string;
};

/** 포장 1회 = 완제품 +units & 벌크 −units×net_weight. 순수 — 사이드 이펙트 없음. */
export const buildPackagingEvents = ({
    userId,
    productId,
    units,
    netWeightGrams,
    beanId,
    blendId,
    opId,
    note,
}: BuildPackagingEventsParams): {
    productEvents: ProductStockEventInsert[];
    roastedEvents: RoastedStockEventInsert[];
} => {
    if (units <= 0) throw new Error('units must be positive');

    const productEvents: ProductStockEventInsert[] = [
        {
            user_id: userId,
            product_id: productId,
            delta_units: units,
            event_type: 'roast_inbound',
            reference_id: opId,
            note,
        },
    ];

    // bean/blend 둘 다 없으면 non-coffee(머치) — 벌크 차감 없음
    const roastedEvents: RoastedStockEventInsert[] =
        beanId || blendId
            ? [
                  {
                      user_id: userId,
                      bean_id: blendId ? null : beanId,
                      blend_id: blendId,
                      delta_grams: -(units * netWeightGrams),
                      event_type: 'packaging',
                      reference_id: opId,
                      note,
                  },
              ]
            : [];

    return { productEvents, roastedEvents };
};
