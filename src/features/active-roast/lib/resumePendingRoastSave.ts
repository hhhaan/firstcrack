import { errorMessage } from '@shared/lib/errorMessage';
import { BatchLimitError } from '@shared/lib/features';
import { logger } from '@shared/lib/logger';
import { bbpTsvPath } from '@shared/lib/tsv-writer';
import type { PlanBatchHandoff, RoastSession } from '@shared/types/database.types';
import { BaseDirectory, exists } from '@tauri-apps/plugin-fs';
import { clearPendingRoastSave, type PendingRoastSave, writePendingRoastSave } from '../model/pendingRoastSave';
import type { SaveRoastParams, SaveRoastResult, SyncRoastCurve } from '../model/save-roast-types';
import { isFixablePlanBatchIdError, isPermanentSaveError } from './saveErrorClassification';
import type { ResolveForRoastFn } from './startNextFromContinue';
import { toPlanBatchHandoff } from './toPlanBatchHandoff';

export type ResumePendingRoastSaveDeps = {
    pending: PendingRoastSave;
    ownerId: string;
    ensureAccess: () => Promise<void>;
    findSession: (id: string) => Promise<RoastSession | null>;
    resolveForRoast: ResolveForRoastFn;
    saveRoast: (params: SaveRoastParams) => Promise<SaveRoastResult>;
    syncBatch: (saved: RoastSession) => Promise<void>;
    refreshCaches: (saved: RoastSession) => Promise<void>;
    syncRoastCurve: SyncRoastCurve;
    hasBbpFile?: (id: string) => Promise<boolean>;
};
const active = new Map<string, Promise<SaveRoastResult>>();
export const isPendingRoastSaveActive = (ownerId: string, sessionId: string | null) =>
    active.has(`${ownerId}:${sessionId}`);
const changed = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('fc-pending-roast-save'));
};
const attention = (message: string) => Object.assign(new Error(message), { code: 'unresolvable_plan_batch_id' });

/** One durable procedure for live saves and recovery. No writes to the live roast store. */
export function resumePendingRoastSave(deps: ResumePendingRoastSaveDeps): Promise<SaveRoastResult> {
    const key = `${deps.pending.params.userId}:${deps.pending.params.sessionId}`;
    const running = active.get(key);
    if (running) return running;
    const work = resume(deps).finally(() => {
        active.delete(key);
        changed();
    });
    active.set(key, work);
    changed();
    return work;
}
async function resume(deps: ResumePendingRoastSaveDeps): Promise<SaveRoastResult> {
    let pending = deps.pending;
    const { sessionId, userId } = pending.params;
    let saved: RoastSession | null = null;
    const checkpoint = (patch: Partial<PendingRoastSave>) => {
        pending = { ...pending, ...patch };
        writePendingRoastSave(pending);
    };
    const verify = (row: RoastSession | null) => {
        if (row && (row.id !== sessionId || row.user_id !== userId || row.status !== 'completed')) {
            throw attention('Saved session identity or status conflicts with this roast');
        }
        return row;
    };
    // Persist submitted intent before auth, materialization or any network request.
    checkpoint({ error: undefined });
    try {
        if (!sessionId || !userId || userId !== deps.ownerId) throw attention('Roast owner/session needs confirmation');
        await deps.ensureAccess();
        saved = verify(await deps.findSession(sessionId));
        if (pending.legacyBbpUnknown) {
            const recorded =
                saved?.bbp_tsv_path ||
                saved?.bbp_seconds ||
                (await (deps.hasBbpFile ?? ((id) => exists(bbpTsvPath(id), { baseDir: BaseDirectory.AppLocalData })))(
                    sessionId,
                ));
            if (!recorded)
                throw attention('Confirm whether between-batch data was recorded before retrying this legacy roast.');
            checkpoint({ bbp: 'pending', legacyBbpUnknown: false });
        }
        if (!saved) {
            if (pending.db === 'saved')
                throw attention('Previously saved roast is missing; check history before retrying');
            let handoff = pending.params.planBatchHandoff;
            let linked = pending.params.formData.linkedBatch ?? null;
            const rawId = pending.params.formData.linkedBatchId;
            const source =
                handoff ??
                linked ??
                (rawId
                    ? ({
                          planBatchId: rawId,
                          planId: '',
                          beanId: pending.params.formData.beanId,
                          blendId: null,
                          beanName: '',
                          batchCount: 0,
                          completedSessions: 0,
                          batchSizeKg: 0,
                          profileId: null,
                      } satisfies PlanBatchHandoff)
                    : null);
            if (source) {
                const latest = await deps.resolveForRoast(userId, source);
                if (latest.status === 'done' || latest.completed_sessions >= latest.batch_count) {
                    throw attention('This batch is complete. Select another batch or explicitly unlink this roast.');
                }
                if (source.beanId !== latest.bean_id || (source.blendId ?? null) !== latest.blend_id) {
                    throw attention(
                        'The scheduled bean/blend changed. Confirm the actual bean and reselect or unlink the batch.',
                    );
                }
                const resolved = toPlanBatchHandoff(latest);
                if (handoff) handoff = resolved;
                else linked = resolved;
            }
            checkpoint({
                needsAttention: false,
                params: {
                    ...pending.params,
                    planBatchHandoff: handoff,
                    formData: { ...pending.params.formData, linkedBatch: linked },
                },
            });
            try {
                saved = verify((await deps.saveRoast(pending.params)).savedSession);
            } catch (err) {
                // INSERT may have committed despite a lost response or competing quota check.
                saved = verify(await deps.findSession(sessionId));
                if (!saved) throw err;
            }
            if (!saved) throw new Error('Roast save returned no session');
        }
        checkpoint({
            db: 'saved',
            needsAttention: false,
            batch: saved.plan_batch_id ? (pending.batch === 'synced' ? 'synced' : 'pending') : 'not_required',
        });
        const committed = saved;
        const stages = await Promise.allSettled([
            (async () => {
                if (pending.batch !== 'pending') return;
                const started = Date.now();
                await deps.syncBatch(committed);
                logger.debug('roast-save-stage', { stage: 'sync-batch', ms: Date.now() - started });
                checkpoint({ batch: 'synced' });
            })(),
            (async () => {
                const profileRequired = pending.profile === 'pending';
                const bbpRequired = pending.bbp === 'pending';
                if (!profileRequired && !bbpRequired) return;
                const started = Date.now();
                await deps.syncRoastCurve({
                    sessionId,
                    roastSessionId: committed.id,
                    ownerId: userId,
                    profileRequired,
                    bbpRequired,
                });
                logger.debug('roast-save-stage', { stage: 'sync-curve', ms: Date.now() - started });
                checkpoint({
                    profile: profileRequired ? 'synced' : pending.profile,
                    bbp: bbpRequired ? 'synced' : pending.bbp,
                });
            })(),
        ]);
        // Refetch only after uploads settle, so an old read cannot overwrite their path patches.
        const refresh = await Promise.allSettled([deps.refreshCaches(committed)]);
        const failed = [...stages, ...refresh].find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        clearPendingRoastSave(userId, sessionId);
        return { savedSession: saved, shouldOpenContinue: saved.plan_batch_id != null };
    } catch (err) {
        checkpoint({
            needsAttention:
                isPermanentSaveError(err) || isFixablePlanBatchIdError(err) || err instanceof BatchLimitError,
            error: errorMessage(err),
        });
        if (saved) return { savedSession: saved, shouldOpenContinue: false, syncPending: true };
        throw err;
    }
}
