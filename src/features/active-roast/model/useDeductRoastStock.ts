import { beanStockEventApi, stockEventKeys } from '@entities/bean-stock-event';
import { blendApi } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { roastedStockKeys } from '@entities/roasted-stock-event';
import { inventoryQueryRoots } from '@shared/lib/query-keys';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { buildBatchRoastedInbound } from '../lib/buildBatchRoastedInbound';
import { buildRoastStockEvents } from '../lib/buildRoastStockEvents';

export interface DeductRoastStockParams {
    deductionGrams: number;
    singleBeanId: string | null;
    blendId: string | null;
    /** roast_session.id or plan_batch.id for idempotent stock events */
    referenceId: string;
    /** Optional roast level for roasted inbound shrink; null → DEFAULT_SHRINK_FACTOR */
    roastLevel?: string | null;
}

export type DeductRoastStockDeps = {
    userId: string;
    qc: QueryClient;
    insertMany?: typeof beanStockEventApi.insertMany;
    getBlend?: typeof blendApi.get;
};

/** Core deduct path — testable without React. Green − and optional roasted + in one TX. */
export async function deductRoastStock(
    { userId, qc, insertMany = beanStockEventApi.insertMany, getBlend = blendApi.get }: DeductRoastStockDeps,
    { deductionGrams, singleBeanId, blendId, referenceId, roastLevel }: DeductRoastStockParams,
): Promise<void> {
    if (deductionGrams <= 0) return;

    let blend: Awaited<ReturnType<typeof blendApi.get>> | null = null;
    if (blendId) {
        blend = await getBlend(blendId);
    }

    const events = buildRoastStockEvents({
        userId,
        deductionGrams,
        singleBeanId,
        blendId,
        referenceId,
        blend,
    });

    const roastedInbound = buildBatchRoastedInbound({
        userId,
        deductionGrams,
        beanId: singleBeanId,
        blendId,
        referenceId,
        roastLevel: roastLevel ?? null,
    });

    await insertMany(events, roastedInbound ? [roastedInbound] : []);

    void qc.invalidateQueries({ queryKey: inventoryQueryRoots.beanStockSummaries });
    void qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(userId) });
    for (const e of events) {
        void qc.invalidateQueries({ queryKey: stockEventKeys.summary(e.bean_id) });
        void qc.invalidateQueries({ queryKey: stockEventKeys.byBean(e.bean_id) });
    }
}

export const useDeductRoastStock = () => {
    const qc = useQueryClient();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();

    return useCallback(
        async (params: DeductRoastStockParams) => {
            if (!isWorkspaceReady || !workspaceOwnerId) return;
            await deductRoastStock({ userId: workspaceOwnerId, qc }, params);
        },
        [workspaceOwnerId, isWorkspaceReady, qc],
    );
};
