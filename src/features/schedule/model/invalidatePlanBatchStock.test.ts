import { stockEventKeys } from '@entities/bean-stock-event';
import { roastedStockKeys } from '@entities/roasted-stock-event';
import { inventoryQueryRoots } from '@shared/lib/query-keys';
import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidatePlanBatchStock } from './invalidatePlanBatchStock';

describe('invalidatePlanBatchStock', () => {
    it('refreshes the same query roots as deductRoastStock', () => {
        const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
        invalidatePlanBatchStock(qc, 'user-1', ['bean-a', 'bean-b']);

        expect(qc.invalidateQueries).toHaveBeenCalledWith({
            queryKey: inventoryQueryRoots.beanStockSummaries,
        });
        expect(qc.invalidateQueries).toHaveBeenCalledWith({
            queryKey: roastedStockKeys.byUser('user-1'),
        });
        expect(qc.invalidateQueries).toHaveBeenCalledWith({
            queryKey: stockEventKeys.summary('bean-a'),
        });
        expect(qc.invalidateQueries).toHaveBeenCalledWith({
            queryKey: stockEventKeys.byBean('bean-a'),
        });
        expect(qc.invalidateQueries).toHaveBeenCalledWith({
            queryKey: stockEventKeys.summary('bean-b'),
        });
        expect(qc.invalidateQueries).toHaveBeenCalledWith({
            queryKey: stockEventKeys.byBean('bean-b'),
        });
        expect(qc.invalidateQueries).toHaveBeenCalledTimes(6);
    });

    it('broad fallback also refreshes per-bean summary and event roots', () => {
        const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
        invalidatePlanBatchStock(qc, 'user-1', [], true);

        expect(qc.invalidateQueries).toHaveBeenCalledWith({
            queryKey: inventoryQueryRoots.beanStockEvents,
        });
        expect(qc.invalidateQueries).toHaveBeenCalledWith({
            queryKey: inventoryQueryRoots.beanStockSummary,
        });
    });
});
