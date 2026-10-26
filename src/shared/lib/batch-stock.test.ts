import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import {
    batchGreenNeededGramsFromBatch,
    isBatchStockShort,
    isRecurringHorizonStockShort,
    recurringHorizonGreenNeededGrams,
} from './batch-stock';

const batch = (over: Partial<PlanBatchWithProgress> = {}): PlanBatchWithProgress =>
    ({
        id: 'pb-1',
        plan_id: 'p-1',
        bean_id: 'bean-1',
        blend_id: null,
        batch_size_kg: 5,
        batch_count: 2,
        completed_sessions: 0,
        sort_order: 0,
        ...over,
    }) as PlanBatchWithProgress;

describe('batchGreenNeededGramsFromBatch', () => {
    it('uses remaining sessions × size', () => {
        // 2 batches, 0 done, 5kg → 10000g
        expect(batchGreenNeededGramsFromBatch(batch())).toBe(10000);
        expect(batchGreenNeededGramsFromBatch(batch({ completed_sessions: 1 }))).toBe(5000);
    });
});

describe('isBatchStockShort', () => {
    it('false when no bean and no blend', () => {
        expect(isBatchStockShort(batch({ bean_id: null, blend_id: null }), 0)).toBe(false);
    });

    it('ignores this batch reservation already inside effectiveGrams', () => {
        expect(isBatchStockShort(batch(), 5000)).toBe(false);
        expect(isBatchStockShort(batch(), 0)).toBe(false);
        expect(isBatchStockShort(batch(), -1)).toBe(true);
        expect(
            isBatchStockShort(batch(), { effectiveGrams: -1, currentGrams: 0, availableGrams: 0, reservedGrams: 0 }),
        ).toBe(true);
    });

    it('false when needed is 0 (all sessions done)', () => {
        expect(isBatchStockShort(batch({ completed_sessions: 2 }), 0)).toBe(false);
    });
});

describe('recurringHorizonGreenNeededGrams', () => {
    it('returns 0 for invalid size/count', () => {
        expect(recurringHorizonGreenNeededGrams('weekly', new Date('2026-07-01'), 0, 1)).toBe(0);
        expect(recurringHorizonGreenNeededGrams('weekly', new Date('2026-07-01'), 5, 0)).toBe(0);
    });

    it('scales by instances in horizon × batchCount × size', () => {
        // Use a fixed "today" relative: if dtstart is far past weekly, still counts from today.
        // Weekly from a recent Monday — just assert positive multiple of 5000g for batchCount=1 size=5.
        const dtstart = new Date();
        dtstart.setHours(0, 0, 0, 0);
        const grams = recurringHorizonGreenNeededGrams('weekly', dtstart, 5, 1);
        expect(grams).toBeGreaterThan(0);
        expect(grams % 5000).toBe(0);
    });
});

describe('isRecurringHorizonStockShort', () => {
    it('false when needed is 0', () => {
        expect(isRecurringHorizonStockShort(0, 'weekly', new Date(), 0, 1)).toBe(false);
    });

    it('true when stock below horizon need', () => {
        const dtstart = new Date();
        dtstart.setHours(0, 0, 0, 0);
        const needed = recurringHorizonGreenNeededGrams('weekly', dtstart, 5, 1);
        expect(isRecurringHorizonStockShort(needed - 1, 'weekly', dtstart, 5, 1)).toBe(true);
        expect(isRecurringHorizonStockShort(needed, 'weekly', dtstart, 5, 1)).toBe(false);
    });
});
