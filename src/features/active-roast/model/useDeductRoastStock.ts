import { beanStockEventApi, stockEventKeys } from '@entities/bean-stock-event';
import { blendApi } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { inventoryQueryRoots } from '@shared/lib/query-keys';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { buildRoastStockEvents } from '../lib/buildRoastStockEvents';

export interface DeductRoastStockParams {
    deductionGrams: number;
    singleBeanId: string | null;
    blendId: string | null;
    /** roast_session.id or plan_batch.id for idempotent stock events */
    referenceId: string;
}

export type DeductRoastStockDeps = {
    userId: string;
    qc: QueryClient;
    insertMany?: typeof beanStockEventApi.insertMany;
    getBlend?: typeof blendApi.get;
};

/** Core deduct path — testable without React. */
export async function deductRoastStock(
    { userId, qc, insertMany = beanStockEventApi.insertMany, getBlend = blendApi.get }: DeductRoastStockDeps,
    { deductionGrams, singleBeanId, blendId, referenceId }: DeductRoastStockParams,
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

    await insertMany(events);

    qc.invalidateQueries({ queryKey: inventoryQueryRoots.beanStockSummaries });
    for (const e of events) {
        // biome-ignore lint/style/noNonNullAssertion: bean_id set for roast events
        qc.invalidateQueries({ queryKey: stockEventKeys.summary(e.bean_id!) });
        // biome-ignore lint/style/noNonNullAssertion: bean_id set for roast events
        qc.invalidateQueries({ queryKey: stockEventKeys.byBean(e.bean_id!) });
    }
}

export const useDeductRoastStock = () => {
    const qc = useQueryClient();
    const { workspaceOwnerId } = useActiveWorkspace();

    return useCallback(
        async (params: DeductRoastStockParams) => {
            if (!workspaceOwnerId) return;
            await deductRoastStock({ userId: workspaceOwnerId, qc }, params);
        },
        [workspaceOwnerId, qc],
    );
};
