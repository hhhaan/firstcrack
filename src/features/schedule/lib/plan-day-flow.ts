import { batchGreenNeededGramsFromBatch } from '@shared/lib/batch-stock';
import { errorMessage } from '@shared/lib/errorMessage';
import type { PlanBatchWithProgress } from '@shared/types/database.types';

export type BatchTarget = { targetId: string; targetPlanId: string; batch?: PlanBatchWithProgress };

export type DeductRoastStockInput = {
    deductionGrams: number;
    singleBeanId: string | null;
    blendId: string | null;
    referenceId: string;
};

export type CompleteBatchFlowDeps = {
    /** Virtual recurring → real exception row (status preserved); real row → identity. */
    ensureMaterialized: (batch: PlanBatchWithProgress) => Promise<BatchTarget>;
    /** Status UPDATE only. */
    commitStatus: (batch: PlanBatchWithProgress, target: BatchTarget, status: 'done') => Promise<void>;
    /** Injected by the composer — green deduction lives in active-roast (features must not import features). */
    deduct: (params: DeductRoastStockInput) => Promise<void>;
    /** i18n key → user-facing alert */
    notify: (key: string) => void;
};

/**
 * Complete-batch order (#108): materialize first (deduct needs the real reference id),
 * then deduct BEFORE committing status=done. A deduct failure leaves the batch
 * not-done, so retry is safe — the reference-unique deduct is idempotent.
 * `roast_already_deducted` still completes (the session save path already took stock).
 */
export async function runCompleteBatchFlow(
    deps: CompleteBatchFlowDeps,
    batch: PlanBatchWithProgress,
    deductStock: boolean,
): Promise<void> {
    const target = await deps.ensureMaterialized(batch);
    batch = target.batch ?? batch;

    if (deductStock) {
        const deductionGrams = batchGreenNeededGramsFromBatch(batch);
        if (!batch.bean_id && !batch.blend_id) {
            deps.notify('schedule.completeBatch.deductStockDisabled');
        } else if (deductionGrams > 0) {
            try {
                await deps.deduct({
                    deductionGrams,
                    singleBeanId: batch.bean_id ?? null,
                    blendId: batch.blend_id ?? null,
                    referenceId: target.targetId,
                });
            } catch (deductErr) {
                // C2: session path already deducted — completing is still correct
                if (errorMessage(deductErr).includes('roast_already_deducted')) {
                    deps.notify('activeRoast.summary.deductSkippedAlreadyDeducted');
                } else {
                    throw deductErr; // status untouched — batch stays incomplete for retry
                }
            }
        }
    }

    await deps.commitStatus(batch, target, 'done');
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
