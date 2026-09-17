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
