import { planBatchApi } from '@entities/plan';
import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import { toPlanBatchHandoff } from './toPlanBatchHandoff';

export type ResolveForRoastFn = (
    ownerId: string,
    source: PlanBatchWithProgress | PlanBatchHandoff,
) => Promise<PlanBatchWithProgress>;

/** Continue start: one `startForRoast` (resolve + in-progress). Does not deduct stock. */
export async function startSelectedContinueBatch(
    ownerId: string,
    row: PlanBatchWithProgress,
): Promise<PlanBatchHandoff> {
    return toPlanBatchHandoff(await planBatchApi.startForRoast(ownerId, row));
}
