export type AdjustStockType = 'adjustment' | 'write_off';
export type AdjustStockSign = '+' | '-';

/** Positive magnitude → signed delta. write_off always negative. null if amount ≤ 0. */
export const signedDelta = (type: AdjustStockType, sign: AdjustStockSign, amount: number): number | null => {
    if (amount <= 0) return null;
    const negative = type === 'write_off' || sign === '-';
    return negative ? -amount : amount;
};

export const trimNote = (note: string): string | null => note.trim() || null;
