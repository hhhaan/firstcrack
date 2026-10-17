import { buildRRule, expandRRuleInRange, type RecurrenceInterval } from '@shared/lib/rrule';
import {
    batchGreenNeededGrams,
    calcPlanBatchCount,
    STOCK_HORIZON_DAYS,
    type StockSummaryValues,
} from '@shared/lib/stock-calc';
import type { PlanBatchWithProgress } from '@shared/types/database.types';

export const batchGreenNeededGramsFromBatch = (batch: PlanBatchWithProgress): number =>
    batchGreenNeededGrams(batch.batch_count, batch.completed_sessions, Number(batch.batch_size_kg));

export { batchGreenNeededGrams };

/** Business calendar for plan batch dates (aligns with roastery schedule entry). */
export const STOCK_RESERVATION_TIME_ZONE = 'Asia/Seoul';

const calendarDateKey = (instant: Date, timeZone = STOCK_RESERVATION_TIME_ZONE): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);

const addCalendarDays = (dateKey: string, days: number): string => {
    const [y, m, d] = dateKey.split('-').map(Number);
    const utc = Date.UTC(y, m - 1, d + days);
    return calendarDateKey(new Date(utc), STOCK_RESERVATION_TIME_ZONE);
};

/** Grams this batch reserves when it is inside the server reservation horizon. */
export const batchOwnReservedGrams = (batch: PlanBatchWithProgress, horizonDays = STOCK_HORIZON_DAYS): number => {
    if (!batch.bean_id || batch.blend_id) return 0;
    if (batch.exception_type === 'cancelled') return 0;
    if (batch.status !== 'pending' && batch.status !== 'in-progress') return 0;

    const todayKey = calendarDateKey(new Date());
    const horizonKey = addCalendarDays(todayKey, horizonDays);

    if (batch.scheduled_date != null && batch.scheduled_date > horizonKey) return 0;

    return batchGreenNeededGramsFromBatch(batch);
};

export const batchAvailableGramsForShortCheck = (
    batch: PlanBatchWithProgress,
    summary: StockSummaryValues | number | undefined,
    horizonDays = STOCK_HORIZON_DAYS,
): number => {
    const effectiveGrams = typeof summary === 'number' ? summary : summary?.effectiveGrams;
    if (effectiveGrams === undefined) return 0;
    return effectiveGrams + batchOwnReservedGrams(batch, horizonDays);
};

export const isBatchStockShort = (
    batch: PlanBatchWithProgress,
    summary: StockSummaryValues | number | undefined,
    horizonDays = STOCK_HORIZON_DAYS,
): boolean => {
    if (!batch.bean_id && !batch.blend_id) return false;
    const needed = batchGreenNeededGramsFromBatch(batch);
    if (needed <= 0) return false;
    const available = batchAvailableGramsForShortCheck(batch, summary, horizonDays);
    return available < needed;
};

/** Green (g) required for all recurring instances within the reservation horizon. */
export const recurringHorizonGreenNeededGrams = (
    interval: RecurrenceInterval,
    dtstart: Date,
    batchSizeKg: number,
    batchCount: number,
): number => {
    if (batchSizeKg <= 0 || batchCount <= 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + STOCK_HORIZON_DAYS);
    horizon.setHours(23, 59, 59, 999);

    const rruleStr = buildRRule(interval);
    const instances = expandRRuleInRange(rruleStr, dtstart, today, horizon);
    return instances.length * batchCount * batchSizeKg * 1000;
};

export const isRecurringHorizonStockShort = (
    effectiveGrams: number | undefined,
    interval: RecurrenceInterval,
    dtstart: Date,
    batchSizeKg: number,
    batchCount: number,
): boolean => {
    const needed = recurringHorizonGreenNeededGrams(interval, dtstart, batchSizeKg, batchCount);
    if (needed <= 0) return false;
    return (effectiveGrams ?? 0) < needed;
};

export { calcPlanBatchCount };
