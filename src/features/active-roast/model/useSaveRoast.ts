import { beanKeys } from '@entities/bean/queries';
import { useUpdatePlanBatch } from '@entities/plan';
import { type RoastSessionInsert, roastSessionApi, useCreateRoastSession } from '@entities/roast';
import { determineStockDeduction } from '@features/active-roast/lib/determine-stock-deduction';
import { serializeRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { useUploadRoastProfile } from '@features/upload-roast-profile';
import { BatchLimitError, canCompleteBatch, planMaxBatchesPerMonth } from '@shared/lib/features';
import { logger } from '@shared/lib/logger';
import { useAuthStore } from '@shared/store/auth';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { Bean, Json, PlanBatchHandoff } from '@shared/types/database.types';
import type { LogEntry } from '@shared/types/roast';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

/** Form fields required to persist a completed roast (matches summary modal). */
export type SaveRoastFormData = {
    notes: string;
    weightGrams: number;
    roastLevel: string | null;
    beanId: string | null;
};

export interface SaveRoastParams {
    formData: SaveRoastFormData;
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
    logEntries: LogEntry[];
}

export interface SaveRoastResult {
    savedSession: Awaited<ReturnType<ReturnType<typeof useCreateRoastSession>['mutateAsync']>>;
    deductionPlan: ReturnType<typeof determineStockDeduction>;
    shouldOpenContinue: boolean;
}

export const useSaveRoast = (planBatchHandoff: PlanBatchHandoff | null) => {
    const user = useAuthStore((s) => s.user);
    const plan = useAuthStore((s) => s.plan);
    const userId = user?.id ?? '';
    const qc = useQueryClient();

    const { mutateAsync: saveRoastSession, isPending: isSaving } = useCreateRoastSession(userId);
    const { mutateAsync: syncRoastCurve } = useUploadRoastProfile();
    const { mutateAsync: updatePlanBatch } = useUpdatePlanBatch(planBatchHandoff?.planId ?? '');
    const incrementCompletedSession = useRoastSessionStore((s) => s.incrementCompletedSession);

    const saveRoast = useCallback(
        async (params: SaveRoastParams): Promise<SaveRoastResult> => {
            if (!user) {
                throw new Error('Not authenticated');
            }

            const monthCap = planMaxBatchesPerMonth(plan);
            if (monthCap != null) {
                const used = await roastSessionApi.countCompletedThisMonth(user.id);
                if (!canCompleteBatch(plan, used)) {
                    throw new BatchLimitError(used, monthCap);
                }
            }

            const { formData, handoffBeanName, sessionId, ...payloadParams } = params;

            const weightGrams = Math.round(formData.weightGrams * 1000);
            // Summary modal can fill bean when roast ran without one
            const resolvedBeanId = formData.beanId ?? payloadParams.selectedBeanId;
            const blendId = planBatchHandoff?.blendId ?? null;

            // Stock deduct / session bean link: require single bean or blend
            if (!resolvedBeanId && !blendId) {
                throw new Error('Select a green bean before saving.');
            }

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
                bean_id: resolvedBeanId,
                profile_id: payloadParams.targetProfileId,
                tsv_path: null,
                plan_batch_id: payloadParams.planBatchHandoff?.planBatchId ?? null,
                events: serializeRoastEvents(payloadParams.logEntries) as Json,
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

            const cachedBeans = user ? qc.getQueryData<Bean[]>(beanKeys.all(user.id)) : undefined;
            const resolvedBeanName =
                handoffBeanName ??
                (resolvedBeanId ? (cachedBeans?.find((b) => b.id === resolvedBeanId)?.name ?? null) : null);

            const deductionPlan = determineStockDeduction({
                planBatchHandoff,
                saveWeight: weightGrams,
                selectedBeanId: resolvedBeanId,
                referenceId: savedSession.id,
                handoffBeanName: resolvedBeanName,
            });

            return {
                savedSession,
                deductionPlan,
                shouldOpenContinue: planBatchHandoff != null,
            };
        },
        [
            user,
            plan,
            qc,
            syncRoastCurve,
            saveRoastSession,
            planBatchHandoff,
            incrementCompletedSession,
            updatePlanBatch,
        ],
    );

    return useMemo(
        () => ({
            saveRoast,
            isSaving,
        }),
        [saveRoast, isSaving],
    );
};
