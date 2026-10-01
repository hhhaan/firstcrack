import type { PlanBatchHandoff } from '@shared/types/database.types';

export interface BatchSelection {
    selectedBeanId: string | null;
    targetProfileId: string | null;
    handoffBeanName: string | null;
    planBatchHandoff: PlanBatchHandoff | null;
}
