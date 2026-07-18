import type { PlanBatchHandoff } from '@shared/types/database.types';

export interface StockDeductionPlan {
    deductionGrams: number;
    singleBeanId: string | null;
    blendId: string | null;
    referenceId: string;
    beanName: string | null;
    canDeduct: boolean;
}

export interface DetermineStockDeductionParams {
    planBatchHandoff: PlanBatchHandoff | null;
    saveWeight: number;
    selectedBeanId: string | null;
    referenceId: string;
    handoffBeanName: string | null;
}

export const determineStockDeduction = (params: DetermineStockDeductionParams): StockDeductionPlan | null => {
    const { planBatchHandoff, saveWeight, selectedBeanId, referenceId, handoffBeanName } = params;

    // Prefer form/save weight (prefilled from batch, user-editable); fall back to plan batch size.
    const deductionGrams =
        saveWeight > 0
            ? saveWeight
            : planBatchHandoff?.batchSizeKg
              ? Math.round(planBatchHandoff.batchSizeKg * 1000)
              : 0;

    const blendId = planBatchHandoff?.blendId ?? null;
    const canDeduct = deductionGrams > 0 && Boolean(selectedBeanId || blendId);

    if (!canDeduct) {
        return null;
    }

    const beanName = handoffBeanName ?? planBatchHandoff?.beanName ?? null;

    return {
        deductionGrams,
        singleBeanId: selectedBeanId,
        blendId,
        referenceId,
        beanName,
        canDeduct: true,
    };
};
