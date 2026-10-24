import { beanStockEventApi } from '@entities/bean-stock-event';
import { roastedStockEventApi } from '@entities/roasted-stock-event';
import { roastSessionStockKeys } from '@shared/lib/query-keys';
import { useQuery } from '@tanstack/react-query';

/**
 * A roast that already moved stock must not be relinked: the ledger rows keep their original
 * bean, so rewriting `roast_sessions.bean_id` alone would leave the record and inventory disagreeing.
 * Plan-linked roasts deduct against the batch, so that reference counts too.
 */
export const useRoastStockRecorded = (sessionId: string, planBatchId: string | null | undefined) =>
    useQuery({
        queryKey: roastSessionStockKeys.bySession(sessionId),
        queryFn: async () => {
            const references = [sessionId, ...(planBatchId ? [planBatchId] : [])];
            const recorded = await Promise.all(
                references.map(async (reference) => {
                    const [greenDeducted, roastedInbound] = await Promise.all([
                        beanStockEventApi.hasRoastDeductionForReference(reference),
                        roastedStockEventApi.hasInboundForReference(reference),
                    ]);
                    return greenDeducted || roastedInbound;
                }),
            );
            return recorded.some(Boolean);
        },
        enabled: !!sessionId,
        meta: { feature: 'history-qc', table: 'bean_stock_events' },
    });
