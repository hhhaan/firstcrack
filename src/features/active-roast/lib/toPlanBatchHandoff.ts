import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';

/** Map a day-plan batch row into the in-session handoff shape. */
export const toPlanBatchHandoff = (batch: PlanBatchWithProgress): PlanBatchHandoff => ({
    planBatchId: batch.id,
    planId: batch.plan_id,
    beanId: batch.bean_id,
    blendId: batch.blend_id,
    beanName: batch.bean_name,
    batchSizeKg: batch.batch_size_kg,
    profileId: batch.roast_profile_id,
    batchCount: batch.batch_count,
    completedSessions: batch.completed_sessions,
});
