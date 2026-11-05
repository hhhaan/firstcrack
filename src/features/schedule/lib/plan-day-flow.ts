import type { PlanBatchWithProgress } from '@shared/types/database.types';

export type BatchTarget = { targetId: string; targetPlanId: string; batch?: PlanBatchWithProgress };

export type CompleteBatchFlowDeps = {
    /** Virtual recurring → real exception row (status preserved); real row → identity. */
    ensureMaterialized: (batch: PlanBatchWithProgress) => Promise<BatchTarget>;
    /** Server locks the batch, deducts only the unrecorded remainder, then marks it done. */
    complete: (batchId: string, deduct: boolean) => Promise<void>;
    /** i18n key → user-facing alert */
    notify: (key: string) => void;
};

/**
 * Materialize a virtual batch, then one server call deducts the remaining slots
 * and marks the row done. The gram count is taken under the batch lock.
 */
export async function runCompleteBatchFlow(
    deps: CompleteBatchFlowDeps,
    batch: PlanBatchWithProgress,
    deductStock: boolean,
): Promise<void> {
    const target = await deps.ensureMaterialized(batch);
    batch = target.batch ?? batch;

    const canDeduct = deductStock && Boolean(batch.bean_id || batch.blend_id);
    if (deductStock && !canDeduct) {
        deps.notify('schedule.completeBatch.deductStockDisabled');
    }
    await deps.complete(target.targetId, canDeduct);
}

/**
 * Reorder payload for moving batches[index] one step.
 * Recurring instances are pinned at order 0 and virtual ids aren't DB rows —
 * moves on or across them return null; the payload holds one-off row ids only.
 */
export function buildReorderIds(batches: PlanBatchWithProgress[], index: number, dir: 'up' | 'down'): string[] | null {
    const swapWith = dir === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= batches.length) return null;
    if (batches[index]?.recurrence_rule_id || batches[swapWith]?.recurrence_rule_id) return null;
    const next = [...batches];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    return next.filter((b) => !b.recurrence_rule_id).map((b) => b.id);
}

/** Next one-off order_index: 1-based (0 pinned for recurring), collision-free after deletes. */
export function nextOneOffOrderIndex(batches: PlanBatchWithProgress[]): number {
    const oneOffs = batches.filter((b) => !b.recurrence_rule_id);
    return oneOffs.length === 0 ? 1 : Math.max(...oneOffs.map((b) => b.order_index)) + 1;
}
