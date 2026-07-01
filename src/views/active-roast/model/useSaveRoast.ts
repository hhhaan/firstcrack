import { useUpdatePlanBatch } from '@entities/plan';
import { type RoastSessionInsert, useCreateRoastSession, useUpdateRoastSession } from '@entities/roast';
import { useUploadRoastProfile } from '@features/upload-roast-profile';
import { logger } from '@shared/lib/logger';
import { useAuthStore } from '@shared/store/auth';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import { BaseDirectory, remove } from '@tauri-apps/plugin-fs';
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
    const { mutateAsync: updateSessionTsv } = useUpdateRoastSession(userId);
    const uploadRoastProfileTsv = useUploadRoastProfile();
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

            if (sessionId) {
                const uploadWithRetry = async () => {
                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            const tsvPath = await uploadRoastProfileTsv(sessionId);
                            if (tsvPath) {
                                await updateSessionTsv({ id: savedSession.id, tsv_path: tsvPath });
                            }
                            return;
                        } catch {
                            if (attempt < 2) {
                                await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
                            }
                        }
                    }
                    logger.capture(new Error('TSV upload failed after 3 retries'), { context: 'saveRoast tsv' });
                };
                uploadWithRetry().finally(() => {
                    if ('__TAURI_INTERNALS__' in window) {
                        remove(`session_${sessionId}.tsv`, { baseDir: BaseDirectory.AppLocalData }).catch(() => {});
                    }
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
        [
            user,
            uploadRoastProfileTsv,
            saveRoastSession,
            planBatchHandoff,
            incrementCompletedSession,
            updatePlanBatch,
            updateSessionTsv,
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
