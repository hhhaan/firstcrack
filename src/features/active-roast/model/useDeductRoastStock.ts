import { beanStockEventApi, stockEventKeys } from '@entities/bean-stock-event';
import { blendApi } from '@entities/blend';
import { inventoryQueryRoots } from '@shared/lib/query-keys';
import { useAuthStore } from '@shared/store/auth';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { buildRoastStockEvents } from '../lib/buildRoastStockEvents';

export interface DeductRoastStockParams {
    deductionGrams: number;
    singleBeanId: string | null;
    blendId: string | null;
    /** roast_session.id or plan_batch.id for idempotent stock events */
    referenceId: string;
}

export const useDeductRoastStock = () => {
    const qc = useQueryClient();
    const user = useAuthStore((s) => s.user);

    return useCallback(
        async ({ deductionGrams, singleBeanId, blendId, referenceId }: DeductRoastStockParams) => {
            if (!user || deductionGrams <= 0) return;

            let blend: Awaited<ReturnType<typeof blendApi.get>> | null = null;
            if (blendId) {
                blend = await blendApi.get(blendId);
            }

            const events = buildRoastStockEvents({
                userId: user.id,
                deductionGrams,
                singleBeanId,
                blendId,
                referenceId,
                blend,
            });

            await beanStockEventApi.insertMany(events);

            qc.invalidateQueries({ queryKey: inventoryQueryRoots.beanStockSummaries });
            for (const e of events) {
                // biome-ignore lint/style/noNonNullAssertion: bean_id set for roast events
                qc.invalidateQueries({ queryKey: stockEventKeys.summary(e.bean_id!) });
                // biome-ignore lint/style/noNonNullAssertion: bean_id set for roast events
                qc.invalidateQueries({ queryKey: stockEventKeys.byBean(e.bean_id!) });
            }
        },
        [user, qc],
    );
};
