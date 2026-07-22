import { beanStockEventApi } from '@entities/bean-stock-event';
import { useActiveWorkspace } from '@entities/organization';
import { useDayBatches } from '@entities/plan';
import { toPlanBatchHandoff } from '@features/active-roast/lib/toPlanBatchHandoff';
import { useSaveRoast } from '@features/active-roast/model/useSaveRoast';
import { useUploadRoastProfile } from '@features/upload-roast-profile';
import { i18n } from '@shared/i18n';
import { isGreenRoastAlreadyClaimed } from '@shared/lib/f3-green-deduct';
import { logger } from '@shared/lib/logger';
import { useAuthStore } from '@shared/store/auth';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import { message } from '@tauri-apps/plugin-dialog';
import { format } from 'date-fns';
import { useCallback } from 'react';
import type { RoastSummaryForm } from '../ui/RoastSummaryModal';
import { useRoastCompletionFlow } from './useRoastCompletionFlow';

export interface UseRoastSaveFlowParams {
    planBatchHandoff: PlanBatchHandoff | null;
    elapsed: number;
    roastStartTimeRef: React.MutableRefObject<number>;
    rawBT: number | null;
    selectedBeanId: string | null;
    targetProfileId: string | null;
    handoffBeanName: string | null;
    sessionId: string | null;
    ambientTemperature?: number | null;
    ambientHumidity?: number | null;
    onResetActiveRoast: () => void;
}

export const useRoastSaveFlow = (params: UseRoastSaveFlowParams) => {
    const {
        planBatchHandoff,
        elapsed,
        roastStartTimeRef,
        rawBT,
        selectedBeanId,
        targetProfileId,
        handoffBeanName,
        sessionId,
        ambientTemperature,
        ambientHumidity,
        onResetActiveRoast,
    } = params;

    const user = useAuthStore((s) => s.user);
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const today = format(new Date(), 'yyyy-MM-dd');
    const { data: dayBatches = [] } = useDayBatches(isWorkspaceReady ? workspaceOwnerId : '', today);

    const flow = useRoastCompletionFlow();
    const { mutateAsync: syncRoastCurve } = useUploadRoastProfile();
    const { saveRoast, isSaving } = useSaveRoast(planBatchHandoff, syncRoastCurve);

    const handleSave = useCallback(
        async (formData: RoastSummaryForm) => {
            if (!user) return;
            try {
                let linkedBatch: PlanBatchHandoff | null = null;
                if (!planBatchHandoff && formData.linkMode === 'schedule' && formData.planBatchId) {
                    const row = dayBatches.find((b) => b.id === formData.planBatchId);
                    if (!row || row.completed_sessions >= row.batch_count) {
                        throw new Error('Selected schedule batch is no longer available.');
                    }
                    linkedBatch = toPlanBatchHandoff(row);
                }

                // F3 UX: warn if schedule already deducted this batch; server also skips (C2).
                let deductStock = formData.deductStock;
                const guardBatchId = planBatchHandoff?.planBatchId ?? linkedBatch?.planBatchId ?? null;
                if (deductStock && guardBatchId) {
                    try {
                        const batchClaimed = await beanStockEventApi.hasRoastDeductionForReference(guardBatchId);
                        if (
                            isGreenRoastAlreadyClaimed(
                                batchClaimed ? [guardBatchId] : [],
                                sessionId ?? '',
                                guardBatchId,
                            )
                        ) {
                            deductStock = false;
                            await message(i18n.t('activeRoast.summary.deductSkippedAlreadyDeducted'), {
                                title: '재고 차감',
                                kind: 'warning',
                            });
                        }
                    } catch (err) {
                        logger.capture(err, { context: 'stockDeduct guard' });
                    }
                }

                const { shouldOpenContinue } = await saveRoast({
                    formData: {
                        notes: formData.notes,
                        weightGrams: formData.weightGrams,
                        outputWeightKg: formData.outputWeightKg,
                        roastLevel: formData.roastLevel,
                        beanId: formData.beanId,
                        linkedBatch,
                        deductStock,
                    },
                    userId: workspaceOwnerId,
                    elapsed,
                    roastStartTimeRef,
                    rawBT,
                    ambientTemperature,
                    ambientHumidity,
                    selectedBeanId,
                    targetProfileId,
                    planBatchHandoff,
                    sessionId,
                    handoffBeanName,
                    logEntries: flow.summaryData?.logEntries ?? [],
                });

                flow.onSaveSuccess({ shouldOpenContinue });
                onResetActiveRoast();
            } catch (err) {
                logger.capture(err, { context: 'roastSummary save' });
                await message(`저장에 실패했습니다.\n\n${err instanceof Error ? err.message : String(err)}`, {
                    title: '저장 실패',
                    kind: 'error',
                });
            }
        },
        [
            user,
            workspaceOwnerId,
            saveRoast,
            elapsed,
            roastStartTimeRef,
            rawBT,
            ambientTemperature,
            ambientHumidity,
            selectedBeanId,
            targetProfileId,
            planBatchHandoff,
            sessionId,
            handoffBeanName,
            dayBatches,
            flow.summaryData,
            flow.onSaveSuccess,
            onResetActiveRoast,
        ],
    );

    return {
        flow,
        isSaving,
        handleSave,
    };
};
