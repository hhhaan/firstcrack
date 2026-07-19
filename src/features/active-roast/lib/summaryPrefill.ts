import type { LastAdhocSave } from '@shared/store/roastSession';
import type { PlanBatchHandoff } from '@shared/types/database.types';

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
