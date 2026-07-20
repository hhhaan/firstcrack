import type { ProductStockEventInsert } from '@entities/product-stock-event';

export type ProductAdjustParams = {
    userId: string;
    productId: string;
    type: 'adjustment' | 'write_off';
    /** write_off는 무시되고 항상 차감 */
    sign: '+' | '-';
    /** 양수 크기 (봉지 수) */
    units: number;
    note: string;
    /** 클라 생성 uuid — (reference_id, product_id, event_type) unique로 이중 제출 방지 */
    referenceId: string;
};

/** 완제품 수동 조정/폐기 이벤트 1건. Pure — API/캐시 부수효과 없음. */
export const buildProductAdjustEvent = (p: ProductAdjustParams): ProductStockEventInsert | null => {
    if (p.units <= 0) return null;
    const negative = p.type === 'write_off' || p.sign === '-';
    return {
        user_id: p.userId,
        product_id: p.productId,
        delta_units: negative ? -p.units : p.units,
        event_type: p.type,
        reference_id: p.referenceId,
        note: p.note.trim() || null,
    };
};
