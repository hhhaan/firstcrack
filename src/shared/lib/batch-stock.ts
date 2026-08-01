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

export const isBatchStockShort = (
    batch: PlanBatchWithProgress,
    summary: StockSummaryValues | number | undefined,
): boolean => {
    if (!batch.bean_id && !batch.blend_id) return false;
    const effectiveGrams = typeof summary === 'number' ? summary : summary?.effectiveGrams;
    const needed = batchGreenNeededGramsFromBatch(batch);
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
