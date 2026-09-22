import { beanStockEventApi } from '@entities/bean-stock-event';
import { i18n } from '@shared/i18n';
import { errorMessage } from '@shared/lib/errorMessage';
import { BatchLimitError } from '@shared/lib/features';
import { logger } from '@shared/lib/logger';
import { bbpTsvPath } from '@shared/lib/tsv-writer';
import { useToastStore } from '@shared/store/toast';
import type { PlanBatchHandoff, RoastSession } from '@shared/types/database.types';
import { BaseDirectory, exists } from '@tauri-apps/plugin-fs';
import {
    clearPendingRoastSave,
    type PendingRoastSave,
    toSaveRoastParams,
    writePendingRoastSave,
} from '../model/pendingRoastSave';
import type { SaveRoastParams, SaveRoastResult, SyncRoastCurve } from '../model/useSaveRoast';
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
    syncRoastCurve: SyncRoastCurve;
    hasBbpFile?: (id: string) => Promise<boolean>;
    hasBatchDeduction?: (id: string) => Promise<boolean>;
};
export type PendingRoastSaveHandle = {
    /** DB row confirmed and pending.db === 'saved' is stored. Rejects if the row never commits. */
    committed: Promise<SaveRoastResult>;
    /** Schedule progress sync finished. Does not wait for the curve upload. */
    scheduleSettled: Promise<{ ok: boolean }>;
    /** Schedule sync and curve upload finished, or the saved row still needs recovery. */
    settled: Promise<SaveRoastResult>;
};

type SaveSignals = {
    resolveCommitted: (result: SaveRoastResult) => void;
    rejectCommitted: (err: unknown) => void;
    settleSchedule: (ok: boolean) => void;
};

const active = new Map<string, PendingRoastSaveHandle>();
const announcedSyncError = new Map<string, string>();
export const isPendingRoastSaveActive = (ownerId: string, sessionId: string | null) =>
    active.has(`${ownerId}:${sessionId}`);
export const resetRoastSyncToasts = () => announcedSyncError.clear();
const changed = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('fc-pending-roast-save'));
};
const attention = (message: string) => Object.assign(new Error(message), { code: 'unresolvable_plan_batch_id' });
const announceSyncFailure = (userId: string, sessionId: string, message: string) => {
    if (!message) return;
    const key = `${userId}:${sessionId}`;
    if (announcedSyncError.get(key) === message) return;
    announcedSyncError.set(key, message);
    useToastStore.getState().show(i18n.t('activeRoast.recovery.syncPending'));
};

/** One durable procedure for live saves and recovery. No writes to the live roast store. */
export function startPendingRoastSave(deps: ResumePendingRoastSaveDeps): PendingRoastSaveHandle {
    const key = `${deps.pending.params.userId}:${deps.pending.params.sessionId}`;
    const running = active.get(key);
    if (running) return running;
    let committedDone = false;
    let scheduleDone = false;
    let resolveCommitted: SaveSignals['resolveCommitted'] = () => {};
    let rejectCommitted: SaveSignals['rejectCommitted'] = () => {};
    let settleSchedule: SaveSignals['settleSchedule'] = () => {};
    const committed = new Promise<SaveRoastResult>((resolve, reject) => {
        resolveCommitted = (result) => {
            if (committedDone) return;
            committedDone = true;
            resolve(result);
        };
        rejectCommitted = (err) => {
            if (committedDone) return;
            committedDone = true;
            reject(err);
        };
    });
    const scheduleSettled = new Promise<{ ok: boolean }>((resolve) => {
        settleSchedule = (ok) => {
            if (scheduleDone) return;
            scheduleDone = true;
            resolve({ ok });
        };
    });
    const settled = resume(deps, { resolveCommitted, rejectCommitted, settleSchedule })
        .catch((err: unknown) => {
            rejectCommitted(err);
            settleSchedule(false);
            throw err;
        })
        .finally(() => {
            active.delete(key);
            changed();
        });
    const handle: PendingRoastSaveHandle = { committed, scheduleSettled, settled };
    void committed.catch(() => {});
    void settled.catch(() => {});
    active.set(key, handle);
    changed();
    return handle;
}

export function resumePendingRoastSave(deps: ResumePendingRoastSaveDeps): Promise<SaveRoastResult> {
    return startPendingRoastSave(deps).settled;
}

async function resume(deps: ResumePendingRoastSaveDeps, signals: SaveSignals): Promise<SaveRoastResult> {
    const started = Date.now();
    let pending = deps.pending;
    const { sessionId, userId } = pending.params;
    let saved: RoastSession | null = null;
    const finish = (result: SaveRoastResult) => {
        logger.debug('roast-save-stage', { stage: 'settled', ms: Date.now() - started });
        return result;
    };
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
    // Persist submitted intent before auth, materialization, F3 or any network request.
    checkpoint({ error: undefined });
    try {
        if (!sessionId || !userId || userId !== deps.ownerId) throw attention('Roast owner/session needs confirmation');
        const accessStarted = Date.now();
        try {
            await deps.ensureAccess();
        } finally {
            logger.debug('roast-save-stage', {
                stage: 'ensure-access',
                ms: Date.now() - accessStarted,
                parent: 'settled',
            });
        }
        const findStarted = Date.now();
        try {
            saved = verify(await deps.findSession(sessionId));
        } finally {
            logger.debug('roast-save-stage', {
                stage: 'find-session',
                ms: Date.now() - findStarted,
                parent: 'settled',
            });
        }
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
                const resolveStarted = Date.now();
                const latest = await deps.resolveForRoast(userId, source).finally(() => {
                    logger.debug('roast-save-stage', {
                        stage: 'resolve-batch',
                        ms: Date.now() - resolveStarted,
                        parent: 'settled',
                    });
                });
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
            const prepared = toSaveRoastParams(pending.params);
            const batchId = handoff?.planBatchId ?? linked?.planBatchId;
            if (prepared.formData.deductStock && batchId) {
                try {
                    const claimed = await (deps.hasBatchDeduction ?? beanStockEventApi.hasRoastDeductionForReference)(
                        batchId,
                    );
                    if (claimed) prepared.formData = { ...prepared.formData, deductStock: false };
                } catch (err) {
                    logger.capture(err, { context: 'stockDeduct guard' });
                }
            }
            const saveStarted = Date.now();
            let recovered = false;
            try {
                saved = verify((await deps.saveRoast(prepared)).savedSession);
            } catch (err) {
                // INSERT may have committed despite a lost response or competing quota check.
                recovered = true;
                saved = verify(await deps.findSession(sessionId));
                if (!saved) throw err;
            }
            if (!saved) throw new Error('Roast save returned no session');
            checkpoint({ db: 'saved', needsAttention: false, batch: saved.plan_batch_id ? 'pending' : 'not_required' });
            logger.debug('roast-save-stage', {
                stage: 'db-committed',
                ms: Date.now() - saveStarted,
                includes: recovered
                    ? ['quota-count', 'tsv-flush', 'save-rpc', 'find-session']
                    : ['quota-count', 'tsv-flush', 'save-rpc'],
            });
        } else {
            checkpoint({ db: 'saved', needsAttention: false, batch: saved.plan_batch_id ? 'pending' : 'not_required' });
        }
        const savedRow = saved;
        if (!savedRow) throw new Error('Roast save returned no session');
        signals.resolveCommitted({ savedSession: savedRow, shouldOpenContinue: false });

        const scheduleStarted = Date.now();
        const schedulePromise = Promise.resolve(deps.syncBatch(savedRow))
            .then(() => {
                if (pending.batch === 'pending') checkpoint({ batch: 'synced' });
                signals.settleSchedule(true);
            })
            .catch((err: unknown) => {
                signals.settleSchedule(false);
                throw err;
            })
            .finally(() => {
                logger.debug('roast-save-stage', {
                    stage: 'sync-batch',
                    ms: Date.now() - scheduleStarted,
                    parent: 'settled',
                    includes: ['schedule-sync', 'cache-invalidate'],
                });
            });
        const curveNeeded = pending.profile !== 'not_required' || pending.bbp !== 'not_required';
        const uploadStarted = Date.now();
        const curvePromise = Promise.resolve(
            curveNeeded
                ? deps.syncRoastCurve({
                      sessionId,
                      roastSessionId: savedRow.id,
                      ownerId: userId,
                      profileRequired: pending.profile !== 'not_required',
                      bbpRequired: pending.bbp !== 'not_required',
                  })
                : undefined,
        ).finally(() => {
            if (!curveNeeded) return;
            logger.debug('roast-save-stage', {
                stage: 'sync-curve',
                ms: Date.now() - uploadStarted,
                parent: 'settled',
            });
        });
        const [scheduleResult, curveResult] = await Promise.allSettled([schedulePromise, curvePromise]);
        if (curveNeeded) {
            if (curveResult.status === 'fulfilled') {
                checkpoint({
                    profile: pending.profile === 'not_required' ? 'not_required' : 'synced',
                    bbp: pending.bbp === 'not_required' ? 'not_required' : 'synced',
                });
            } else {
                let row: RoastSession | null = null;
                try {
                    row = verify(await deps.findSession(sessionId));
                } catch (err) {
                    logger.capture(err, { context: 'curve checkpoint lookup' });
                }
                checkpoint({
                    profile: pending.profile === 'not_required' ? 'not_required' : row?.tsv_path ? 'synced' : 'pending',
                    bbp: pending.bbp === 'not_required' ? 'not_required' : row?.bbp_tsv_path ? 'synced' : 'pending',
                });
            }
        }
        const problems = [scheduleResult, curveResult].filter(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        if (problems.length > 0) {
            const err = problems[0].reason;
            const message = errorMessage(err);
            checkpoint({
                needsAttention:
                    isPermanentSaveError(err) || isFixablePlanBatchIdError(err) || err instanceof BatchLimitError,
                error: message,
            });
            announceSyncFailure(userId, sessionId, message);
            return finish({ savedSession: savedRow, shouldOpenContinue: false, syncPending: true });
        }
        const durable =
            (pending.batch === 'synced' || pending.batch === 'not_required') &&
            (pending.profile === 'synced' || pending.profile === 'not_required') &&
            (pending.bbp === 'synced' || pending.bbp === 'not_required');
        if (!durable) {
            const message = pending.error ?? 'Roast sync incomplete';
            checkpoint({ error: message });
            announceSyncFailure(userId, sessionId, message);
            return finish({ savedSession: savedRow, shouldOpenContinue: false, syncPending: true });
        }
        clearPendingRoastSave(userId, sessionId);
        announcedSyncError.delete(`${userId}:${sessionId}`);
        return finish({ savedSession: savedRow, shouldOpenContinue: savedRow.plan_batch_id != null });
    } catch (err) {
        checkpoint({
            needsAttention:
                isPermanentSaveError(err) || isFixablePlanBatchIdError(err) || err instanceof BatchLimitError,
            error: errorMessage(err),
        });
        signals.settleSchedule(false);
        if (saved && sessionId && userId) {
            signals.resolveCommitted({ savedSession: saved, shouldOpenContinue: false });
            announceSyncFailure(userId, sessionId, errorMessage(err));
            return finish({ savedSession: saved, shouldOpenContinue: false, syncPending: true });
        }
        signals.rejectCommitted(err);
        throw err;
    }
}
