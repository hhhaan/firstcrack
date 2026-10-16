import { planBatchApi } from '@entities/plan';
import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import { toPlanBatchHandoff } from './toPlanBatchHandoff';

export type ResolveForRoastFn = (
    ownerId: string,
    source: PlanBatchWithProgress | PlanBatchHandoff,
) => Promise<PlanBatchWithProgress>;

/** Materialize the selected Continue row only, then hand a real UUID to startBatch. */
export async function startNextFromContinue(
    ownerId: string,
    row: PlanBatchWithProgress,
    resolveForRoast: ResolveForRoastFn,
): Promise<PlanBatchHandoff> {
    return toPlanBatchHandoff(await resolveForRoast(ownerId, row));
}

/** Continue start: one `startForRoast` (resolve + in-progress). Does not deduct stock. */
export async function startSelectedContinueBatch(
    ownerId: string,
    row: PlanBatchWithProgress,
): Promise<PlanBatchHandoff> {
    return toPlanBatchHandoff(await planBatchApi.startForRoast(ownerId, row));
}
