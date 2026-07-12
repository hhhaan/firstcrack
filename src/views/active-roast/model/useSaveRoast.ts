import { useUpdatePlanBatch } from '@entities/plan';
import { type RoastSessionInsert, useCreateRoastSession } from '@entities/roast';
import { useUploadRoastProfile } from '@features/upload-roast-profile';
import { logger } from '@shared/lib/logger';
import { useAuthStore } from '@shared/store/auth';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import { useCallback, useMemo } from 'react';
import { determineStockDeduction } from '../lib/determine-stock-deduction';
import type { RoastSummaryForm } from '../ui/RoastSummaryModal';

export interface SaveRoastParams {
    formData: RoastSummaryForm;
    handoffBeanName: string | null;
    sessionId: string | null;
    userId: string;
    elapsed: number;
    roastStartTimeRef: React.MutableRefObject<number>;
    rawBT: number | null;
    ambientTemperature?: number | null;
    ambientHumidity?: number | null;
    selectedBeanId: string | null;
    targetProfileId: string | null;
    planBatchHandoff: PlanBatchHandoff | null;
}

export interface SaveRoastResult {
    savedSession: Awaited<ReturnType<ReturnType<typeof useCreateRoastSession>['mutateAsync']>>;
    deductionPlan: ReturnType<typeof determineStockDeduction>;
    shouldOpenContinue: boolean;
}

export const useSaveRoast = (planBatchHandoff: PlanBatchHandoff | null) => {
    const user = useAuthStore((s) => s.user);
    const userId = user?.id ?? '';

    const { mutateAsync: saveRoastSession, isPending: isSaving } = useCreateRoastSession(userId);
    const { mutateAsync: syncRoastCurve } = useUploadRoastProfile();
    const { mutateAsync: updatePlanBatch } = useUpdatePlanBatch(planBatchHandoff?.planId ?? '');
    const incrementCompletedSession = useRoastSessionStore((s) => s.incrementCompletedSession);

    const saveRoast = useCallback(
        async (params: SaveRoastParams): Promise<SaveRoastResult> => {
            if (!user) {
                throw new Error('Not authenticated');
            }

            const { formData, handoffBeanName, sessionId, ...payloadParams } = params;

            const weightGrams = Math.round(formData.weightGrams * 1000);

            const roastedAt =
                payloadParams.roastStartTimeRef.current > 0
                    ? new Date(payloadParams.roastStartTimeRef.current).toISOString()
                    : null;

            const payload: RoastSessionInsert = {
                user_id: user.id,
                weight_grams: weightGrams,
                status: 'completed',
                roasted_at: roastedAt,
                duration_seconds: payloadParams.elapsed,
                drop_temp_celsius: payloadParams.rawBT != null ? Math.round(payloadParams.rawBT) : null,
                roast_level: formData.roastLevel,
                scheduled_at: null,
                notes: formData.notes || null,
                ambient_temp_celsius: payloadParams.ambientTemperature ?? null,
                ambient_humidity_pct: payloadParams.ambientHumidity ?? null,
                bean_id: payloadParams.selectedBeanId,
                profile_id: payloadParams.targetProfileId,
                tsv_path: null,
                plan_batch_id: payloadParams.planBatchHandoff?.planBatchId ?? null,
            };

            const savedSession = await saveRoastSession(payload);

            // Meta returns immediately; curve sync background. Local TSV kept if sync fails.
            if (sessionId) {
                void syncRoastCurve({ sessionId, roastSessionId: savedSession.id }).catch((err) => {
                    logger.capture(err, { context: 'saveRoast tsv' });
                });
            }

            const newCompletedCount = (planBatchHandoff?.completedSessions ?? 0) + 1;
            const isNowBatchDone = planBatchHandoff != null && newCompletedCount >= planBatchHandoff.batchCount;

            incrementCompletedSession();

            if (isNowBatchDone && planBatchHandoff) {
                updatePlanBatch({ id: planBatchHandoff.planBatchId, status: 'done' }).catch((err) =>
                    logger.capture(err, { context: 'saveRoast batch status' }),
                );
            }

            const deductionPlan = determineStockDeduction({
                planBatchHandoff,
                saveWeight: weightGrams,
                selectedBeanId: payloadParams.selectedBeanId,
                referenceId: savedSession.id,
                handoffBeanName,
            });

            return {
                savedSession,
                deductionPlan,
                shouldOpenContinue: planBatchHandoff != null,
            };
        },
        [user, syncRoastCurve, saveRoastSession, planBatchHandoff, incrementCompletedSession, updatePlanBatch],
    );

    return useMemo(
        () => ({
            saveRoast,
            isSaving,
        }),
        [saveRoast, isSaving],
    );
};
