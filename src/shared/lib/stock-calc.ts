/** Reservation horizon for stock alerts (4 weeks). */
export const STOCK_HORIZON_DAYS = 28;

/** RRULE preview cap in expandRRule(). */
export const UI_PREVIEW_DAYS = 365;

export type StockSummaryValues = {
    currentGrams: number;
    availableGrams: number;
    reservedGrams: number;
    effectiveGrams: number;
};

export const calcPlanBatchCount = (
    targetRoastedKg: number,
    batchSizeKg: number,
    yieldPct: number,
    storedBatchCount?: number | null,
): number => {
    if (storedBatchCount != null && storedBatchCount > 0) return storedBatchCount;
    if (batchSizeKg <= 0 || targetRoastedKg <= 0) return 1;
    const roastedPerBatch = batchSizeKg * Math.max(yieldPct, 0.0001);
    return Math.ceil(targetRoastedKg / roastedPerBatch);
};

export const batchGreenNeededGrams = (
    batchCount: number,
    completedSessions: number,
    batchSizeKg: number,
    ratioPct = 100,
): number => {
    const remaining = Math.max(0, batchCount - completedSessions);
    return Math.round(remaining * batchSizeKg * 1000 * (ratioPct / 100));
};

export const parseStockSummaryJson = (raw: {
    current_grams?: number;
    available_grams?: number;
    reserved_grams?: number;
    effective_grams?: number;
}): StockSummaryValues => ({
    currentGrams: raw.current_grams ?? 0,
    availableGrams: raw.available_grams ?? 0,
    reservedGrams: raw.reserved_grams ?? 0,
    effectiveGrams: raw.effective_grams ?? 0,
});

/** @deprecated Use STOCK_HORIZON_DAYS */
export const STOCK_RESERVATION_HORIZON_DAYS = STOCK_HORIZON_DAYS;
