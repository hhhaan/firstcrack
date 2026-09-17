import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import { type PendingRoastSave, toSaveRoastParams, writePendingRoastSave } from '../model/pendingRoastSave';
import type { SaveRoastParams, SaveRoastResult } from '../model/useSaveRoast';
import { isFixablePlanBatchIdError } from './saveErrorClassification';
import type { ResolveForRoastFn } from './startNextFromContinue';
import { toPlanBatchHandoff } from './toPlanBatchHandoff';

export type ResumePendingRoastSaveDeps = {
    pending: PendingRoastSave;
    ownerId: string;
    resolveForRoast: ResolveForRoastFn;
    saveRoast: (params: SaveRoastParams) => Promise<SaveRoastResult>;
};

/**
 * Shared save procedure: resolve virtual plan ids, keep the session UUID,
 * then save. 22P02 / bad ids mark the snapshot needs_attention instead of clearing it.
 */
export async function resumePendingRoastSave(deps: ResumePendingRoastSaveDeps): Promise<SaveRoastResult> {
    const { pending, ownerId, resolveForRoast, saveRoast } = deps;
    const sessionId = pending.params.sessionId;

    let planBatchHandoff = pending.params.planBatchHandoff;
    let linkedBatch = pending.params.formData.linkedBatch ?? null;
    const source = planBatchHandoff ?? linkedBatch;

    try {
        if (source) {
            const latest: PlanBatchWithProgress = await resolveForRoast(ownerId, source);
            const resolved: PlanBatchHandoff = toPlanBatchHandoff(latest);
            if (planBatchHandoff) planBatchHandoff = resolved;
            else linkedBatch = resolved;
        }

        const next: PendingRoastSave = {
            ...pending,
            needsAttention: false,
            params: {
                ...pending.params,
                sessionId,
                planBatchHandoff,
                formData: { ...pending.params.formData, linkedBatch },
            },
        };
        writePendingRoastSave(next);

        return await saveRoast(toSaveRoastParams(next.params));
    } catch (err) {
        if (isFixablePlanBatchIdError(err)) {
            writePendingRoastSave({
                ...pending,
                needsAttention: true,
                params: {
                    ...pending.params,
                    sessionId,
                    planBatchHandoff,
                    formData: { ...pending.params.formData, linkedBatch },
                },
            });
        }
        throw err;
    }
}
