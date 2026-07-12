import { beanStockEventApi, stockEventKeys } from '@entities/bean-stock-event';
import { blendApi } from '@entities/blend';
import { useAuthStore } from '@shared/store/auth';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { buildBlendDeductions } from '../lib/buildBlendDeductions';

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

            const events: Parameters<typeof beanStockEventApi.insertMany>[0] = [];

            if (singleBeanId && !blendId) {
                events.push({
                    user_id: user.id,
                    bean_id: singleBeanId,
                    delta_grams: -deductionGrams,
                    event_type: 'roast',
                    reference_id: referenceId,
                });
            }

            if (blendId) {
                const blend = await blendApi.get(blendId);
                const deductions = buildBlendDeductions(deductionGrams, blend.blend_components);
                for (const d of deductions) {
                    if (d.grams <= 0) continue;
                    events.push({
                        user_id: user.id,
                        bean_id: d.beanId,
                        delta_grams: -d.grams,
                        event_type: 'roast',
                        reference_id: referenceId,
                        note: `${blend.name} 블렌드 차감`,
                    });
                }
            }

            if (!events.length) return;

            await beanStockEventApi.insertMany(events);

            qc.invalidateQueries({ queryKey: ['bean-stock-summaries'] });
            for (const e of events) {
                // biome-ignore lint/style/noNonNullAssertion: error already checked above
                qc.invalidateQueries({ queryKey: stockEventKeys.summary(e.bean_id!) });
                // biome-ignore lint/style/noNonNullAssertion: error already checked above
                qc.invalidateQueries({ queryKey: stockEventKeys.byBean(e.bean_id!) });
            }
        },
        [user, qc],
    );
};
