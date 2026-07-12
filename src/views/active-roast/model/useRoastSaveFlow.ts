import { useDeductRoastStock } from '@features/active-roast/model/useDeductRoastStock';
import { logger } from '@shared/lib/logger';
import { useAuthStore } from '@shared/store/auth';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import { message } from '@tauri-apps/plugin-dialog';
import { useCallback } from 'react';
import type { RoastSummaryForm } from '../ui/RoastSummaryModal';
import { useRoastCompletionFlow } from './useRoastCompletionFlow';
import { useSaveRoast } from './useSaveRoast';

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
    const flow = useRoastCompletionFlow();
    const { saveRoast, isSaving } = useSaveRoast(planBatchHandoff);
    const deductRoastStock = useDeductRoastStock();

    const handleSave = useCallback(
        async (formData: RoastSummaryForm) => {
            if (!user) return;
            try {
                const { deductionPlan, shouldOpenContinue } = await saveRoast({
                    formData,
                    userId: user.id,
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
                flow.onSaveSuccess({ deductionPlan, shouldOpenContinue });
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
            flow.summaryData,
            flow.onSaveSuccess,
            onResetActiveRoast,
        ],
    );

    const handleStockDeductConfirm = useCallback(
        async (deductStock: boolean) => {
            try {
                if (deductStock && flow.pendingStockDeduct) {
                    await deductRoastStock({
                        deductionGrams: flow.pendingStockDeduct.deductionGrams,
                        singleBeanId: flow.pendingStockDeduct.singleBeanId,
                        blendId: flow.pendingStockDeduct.blendId,
                        referenceId: flow.pendingStockDeduct.referenceId,
                    });
                }
            } catch (err) {
                logger.capture(err, { context: 'stockDeduct confirm' });
                await message(`재고 차감에 실패했습니다.\n\n${err instanceof Error ? err.message : String(err)}`, {
                    title: '재고 차감 실패',
                    kind: 'error',
                });
            } finally {
                flow.finishDeductFlow();
            }
        },
        [flow.pendingStockDeduct, deductRoastStock, flow.finishDeductFlow],
    );

    return {
        flow,
        isSaving,
        handleSave,
        handleStockDeductConfirm,
    };
};
