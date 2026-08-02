import type { ProductStockEventInsert } from '@entities/product-stock-event';
import type { AdjustStockSign, AdjustStockType } from '@shared/ui/AdjustStockFields';
import { signedDelta, trimNote } from './signedDelta';

export type ProductAdjustParams = {
    userId: string;
    productId: string;
    type: AdjustStockType;
    /** write_off ignores sign — always deducts */
    sign: AdjustStockSign;
    /** Positive magnitude (bags) */
    units: number;
    note: string;
    /** Client uuid — (reference_id, product_id, event_type) unique guards double-submit */
    referenceId: string;
};

/** Finished-goods manual adjust / write-off. Pure — no API side effects. */
export const buildProductAdjustEvent = (p: ProductAdjustParams): ProductStockEventInsert | null => {
    const delta = signedDelta(p.type, p.sign, p.units);
    if (delta == null) return null;
    return {
        user_id: p.userId,
        product_id: p.productId,
        delta_units: delta,
        event_type: p.type,
        reference_id: p.referenceId,
        note: trimNote(p.note),
    };
};
