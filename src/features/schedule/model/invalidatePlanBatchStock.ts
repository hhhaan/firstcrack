import { stockEventKeys } from '@entities/bean-stock-event';
import { roastedStockKeys } from '@entities/roasted-stock-event';
import { inventoryQueryRoots } from '@shared/lib/query-keys';
import type { QueryClient } from '@tanstack/react-query';

/** Match `deductRoastStock` cache refresh after a batch complete deduct. */
export function invalidatePlanBatchStock(qc: QueryClient, userId: string, beanIds: string[], broad = false): void {
    void qc.invalidateQueries({ queryKey: inventoryQueryRoots.beanStockSummaries });
    void qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(userId) });
    if (broad) {
        void qc.invalidateQueries({ queryKey: inventoryQueryRoots.beanStockEvents });
    }
    for (const beanId of beanIds) {
        void qc.invalidateQueries({ queryKey: stockEventKeys.summary(beanId) });
        void qc.invalidateQueries({ queryKey: stockEventKeys.byBean(beanId) });
    }
}
