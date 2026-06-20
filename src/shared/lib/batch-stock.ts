import { buildRRule, expandRRuleInRange, type RecurrenceInterval } from '@shared/lib/rrule';
import type { PlanBatchWithProgress } from '@shared/types/database.types';

/** Matches bean-stock-event reservation horizon (4 weeks). */
export const STOCK_RESERVATION_HORIZON_DAYS = 28;

/** Remaining green coffee (g) needed to complete this plan batch. */
export const batchGreenNeededGrams = (batch: PlanBatchWithProgress): number => {
    const remaining = Math.max(0, batch.batch_count - batch.completed_sessions);
    return remaining * Number(batch.batch_size_kg) * 1000;
};

export const isBatchStockShort = (batch: PlanBatchWithProgress, effectiveGrams: number | undefined): boolean => {
    if (!batch.bean_id) return false;
    const needed = batchGreenNeededGrams(batch);
    if (needed <= 0) return false;
    return (effectiveGrams ?? 0) < needed;
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
    horizon.setDate(horizon.getDate() + STOCK_RESERVATION_HORIZON_DAYS);
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
