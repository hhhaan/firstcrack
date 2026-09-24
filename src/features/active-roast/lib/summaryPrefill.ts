import type { LastAdhocSave } from '@shared/store/roastSession';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import type { RoastSummaryForm } from './roastSummarySchema';

/** 저장 폼 프리필. 우선순위: 스케줄 핸드오프 > (bean은 헤더 선택 >) 직전 애드혹 배치 > 빈값. */
export const summaryPrefill = (
    handoff: PlanBatchHandoff | null,
    lastAdhoc: LastAdhocSave | null,
    selectedBeanId: string | null,
): { weightGrams: number; roastLevel: string | null; beanId: string | null } => {
    const last = handoff ? null : lastAdhoc;
    return {
        weightGrams: handoff?.batchSizeKg ?? last?.weightKg ?? 0,
        roastLevel: last?.roastLevel ?? null,
        beanId: handoff?.beanId ?? selectedBeanId ?? last?.beanId ?? null,
    };
};

/** Open / reopen initials. Later live header or B handoff must not rebuild this. */
export const summaryFormInitialValues = (
    handoff: PlanBatchHandoff | null,
    lastAdhoc: LastAdhocSave | null,
    selectedBeanId: string | null,
): RoastSummaryForm => {
    const prefill = summaryPrefill(handoff, lastAdhoc, selectedBeanId);
    return {
        notes: '',
        weightGrams: prefill.weightGrams,
        outputWeightKg: undefined,
        roastLevel: prefill.roastLevel,
        beanId: prefill.beanId,
        beanLabel: '',
        linkMode: handoff ? 'schedule' : 'none',
        planBatchId: handoff?.planBatchId ?? null,
        deductStock: Boolean(handoff) || prefill.beanId != null,
    };
};

export type ScheduleLinkBase = { weightGrams: number; beanId: string | null };

/**
 * Schedule select applies that batch's weight/bean.
 * Clear restores the open-time base. Same batch does not rewrite user edits.
 */
export const scheduleLinkFieldPatch = (input: {
    prevMode: 'schedule' | 'none';
    mode: 'schedule' | 'none';
    batch: { id: string; batchSizeKg: number; beanId: string | null } | null;
    prevBatchId: string | null;
    base: ScheduleLinkBase;
}): ScheduleLinkBase | null => {
    if (
        input.mode === 'schedule' &&
        input.batch &&
        (input.prevMode !== 'schedule' || input.prevBatchId !== input.batch.id)
    ) {
        return {
            weightGrams: input.batch.batchSizeKg > 0 ? input.batch.batchSizeKg : input.base.weightGrams,
            beanId: input.batch.beanId ?? input.base.beanId,
        };
    }
    if (input.mode === 'none' && input.prevMode === 'schedule') return input.base;
    return null;
};

/** Checkbox visibility. Inventory truth is the save path, not this flag. */
export const isDeductDisplayEligible = (input: {
    customBean: boolean;
    deductionKg: number;
    resolvedBeanId: string | null;
    blendId: string | null;
}): boolean => !input.customBean && input.deductionKg > 0 && Boolean(input.resolvedBeanId || input.blendId);
