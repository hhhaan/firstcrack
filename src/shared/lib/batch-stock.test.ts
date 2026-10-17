import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import {
    batchAvailableGramsForShortCheck,
    batchGreenNeededGramsFromBatch,
    batchOwnReservedGrams,
    isBatchStockShort,
    isRecurringHorizonStockShort,
    recurringHorizonGreenNeededGrams,
} from './batch-stock';
import { STOCK_HORIZON_DAYS } from './stock-calc';

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
        status: 'done',
        scheduled_date: null,
        exception_type: null,
        ...over,
    }) as PlanBatchWithProgress;

describe('batchGreenNeededGramsFromBatch', () => {
    it('uses remaining sessions × size', () => {
        expect(batchGreenNeededGramsFromBatch(batch())).toBe(10000);
        expect(batchGreenNeededGramsFromBatch(batch({ completed_sessions: 1 }))).toBe(5000);
    });
});

describe('isBatchStockShort', () => {
    it('false when no bean and no blend', () => {
        expect(isBatchStockShort(batch({ bean_id: null, blend_id: null }), 0)).toBe(false);
    });

    it('true when effective < needed (no own reservation)', () => {
        expect(
            isBatchStockShort(batch(), { effectiveGrams: 9999, currentGrams: 0, availableGrams: 0, reservedGrams: 0 }),
        ).toBe(true);
        expect(isBatchStockShort(batch(), 10000)).toBe(false);
        expect(isBatchStockShort(batch(), 9999)).toBe(true);
    });

    it('false when needed is 0 (all sessions done)', () => {
        expect(isBatchStockShort(batch({ completed_sessions: 2 }), 0)).toBe(false);
    });

    it('still warns when another batch reservation consumes stock (blend batches have no own add-back)', () => {
        const today = new Date();
        const scheduled = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const b = batch({ status: 'pending', scheduled_date: scheduled, bean_id: null, blend_id: 'blend-1' });
        expect(isBatchStockShort(b, 2000)).toBe(true);
        expect(isBatchStockShort(b, 10000)).toBe(false);
    });

    it('adds back own reservation for pending in-horizon batch', () => {
        const today = new Date();
        const scheduled = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const b = batch({ status: 'pending', scheduled_date: scheduled });
        expect(
            isBatchStockShort(b, {
                effectiveGrams: 5000,
                currentGrams: 15000,
                availableGrams: 15000,
                reservedGrams: 10000,
            }),
        ).toBe(false);
    });

    it('does not add own reservation when scheduled beyond horizon', () => {
        const far = new Date();
        far.setDate(far.getDate() + STOCK_HORIZON_DAYS + 5);
        const scheduled = `${far.getFullYear()}-${String(far.getMonth() + 1).padStart(2, '0')}-${String(far.getDate()).padStart(2, '0')}`;
        const b = batch({ status: 'pending', scheduled_date: scheduled });
        expect(batchOwnReservedGrams(b)).toBe(0);
        expect(isBatchStockShort(b, 5000)).toBe(true);
    });
});

describe('batchAvailableGramsForShortCheck', () => {
    it('returns 0 when summary missing', () => {
        expect(batchAvailableGramsForShortCheck(batch(), undefined)).toBe(0);
    });
});

describe('recurringHorizonGreenNeededGrams', () => {
    it('returns 0 for invalid size/count', () => {
        expect(recurringHorizonGreenNeededGrams('weekly', new Date('2026-07-01'), 0, 1)).toBe(0);
        expect(recurringHorizonGreenNeededGrams('weekly', new Date('2026-07-01'), 5, 0)).toBe(0);
    });

    it('scales by instances in horizon × batchCount × size', () => {
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
