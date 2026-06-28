import { useUpdatePlanBatch } from '@entities/plan';
import { useCreateRoastSession } from '@entities/roast';
import { useUploadRoastProfile } from '@features/upload-roast-profile';
import { useAuthStore } from '@shared/store/auth';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import { BaseDirectory, remove } from '@tauri-apps/plugin-fs';
import { useCallback, useMemo } from 'react';
import { type BuildSavePayloadParams, buildRoastSavePayload } from '../lib/build-roast-save-payload';
import { determineStockDeduction } from '../lib/determine-stock-deduction';
import type { RoastSummaryForm } from '../lib/schema';

export interface SaveRoastParams extends Omit<BuildSavePayloadParams, 'saveLevel' | 'saveWeight' | 'notes'> {
    formData: RoastSummaryForm;
    handoffBeanName: string | null;
    sessionId: string | null;
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
    const uploadRoastProfileTsv = useUploadRoastProfile();
    const { mutateAsync: updatePlanBatch } = useUpdatePlanBatch(planBatchHandoff?.planId ?? '');
    const incrementCompletedSession = useRoastSessionStore((s) => s.incrementCompletedSession);

    const saveRoast = useCallback(
        async (params: SaveRoastParams): Promise<SaveRoastResult> => {
            if (!user) {
                throw new Error('Not authenticated');
            }

            const { formData, handoffBeanName, sessionId, ...payloadParams } = params;

            let tsvPath: string | null = null;
            if (sessionId) {
                try {
                    tsvPath = await uploadRoastProfileTsv(sessionId);
                } catch (err) {
                    console.error('[saveRoast] TSV upload failed, saving session without profile:', err);
                }
            }

            const weightGrams = Math.round(formData.weightGrams * 1000);

            const payload = buildRoastSavePayload(
                {
                    ...payloadParams,
                    userId: user.id,
                    saveWeight: weightGrams,
                    saveLevel: formData.roastLevel,
                    notes: formData.notes,
                },
                tsvPath,
            );

            const savedSession = await saveRoastSession(payload);

            if (sessionId && '__TAURI_INTERNALS__' in window) {
                remove(`session_${sessionId}.tsv`, { baseDir: BaseDirectory.AppLocalData }).catch(() => {});
            }

            const newCompletedCount = (planBatchHandoff?.completedSessions ?? 0) + 1;
            const isNowBatchDone = planBatchHandoff != null && newCompletedCount >= planBatchHandoff.batchCount;

            incrementCompletedSession();

            if (isNowBatchDone && planBatchHandoff) {
                updatePlanBatch({ id: planBatchHandoff.planBatchId, status: 'done' }).catch((err) =>
                    console.error('[saveRoast] batch status update failed:', err),
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
        [user, uploadRoastProfileTsv, saveRoastSession, planBatchHandoff, incrementCompletedSession, updatePlanBatch],
    );

    return useMemo(
        () => ({
            saveRoast,
            isSaving,
        }),
        [saveRoast, isSaving],
    );
};
