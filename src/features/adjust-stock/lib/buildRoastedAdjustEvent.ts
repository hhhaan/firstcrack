import type { RoastedStockEventInsert } from '@entities/roasted-stock-event';
import { type AdjustStockSign, type AdjustStockType, signedDelta, trimNote } from './signedDelta';

export type RoastedAdjustParams = {
    userId: string;
    beanId: string | null;
    blendId: string | null;
    type: AdjustStockType;
    /** write_off ignores sign — always deducts */
    sign: AdjustStockSign;
    /** Positive magnitude (g) */
    grams: number;
    note: string;
    /** Client uuid — partial unique index guards double-submit */
    referenceId: string;
};

/** Bulk roasted manual adjust / write-off. Pure — no API side effects. */
export const buildRoastedAdjustEvent = (p: RoastedAdjustParams): RoastedStockEventInsert | null => {
    if (!p.beanId && !p.blendId) return null;
    const delta = signedDelta(p.type, p.sign, p.grams);
    if (delta == null) return null;
    return {
        user_id: p.userId,
        bean_id: p.blendId ? null : p.beanId,
        blend_id: p.blendId ?? null,
        delta_grams: delta,
        event_type: p.type,
        reference_id: p.referenceId,
        note: trimNote(p.note),
    };
};
