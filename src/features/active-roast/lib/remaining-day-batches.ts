import type { PlanBatchWithProgress } from '@shared/types/database.types';

export type RemainingDayBatchesOpts = {
    /** Prefer this batch id at the front when it still has remaining sessions. */
    preferBatchId?: string | null;
};

/** Batches with incomplete sessions, optional prefer id first. */
export function getRemainingDayBatches(
    batches: PlanBatchWithProgress[],
    opts?: RemainingDayBatchesOpts,
): PlanBatchWithProgress[] {
    const remaining = batches.filter((b) => b.completed_sessions < b.batch_count);
    const preferId = opts?.preferBatchId;
    if (!preferId) return remaining;

    const preferred = remaining.find((b) => b.id === preferId);
    if (!preferred) return remaining;
    return [preferred, ...remaining.filter((b) => b.id !== preferId)];
}

export function shouldOfferNextRoast(remaining: PlanBatchWithProgress[]): boolean {
    return remaining.length > 0;
}
