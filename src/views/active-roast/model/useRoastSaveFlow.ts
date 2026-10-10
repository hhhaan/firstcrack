import { useActiveWorkspace } from '@entities/organization';
import { invalidateScheduledBatchQueries, planBatchApi, planKeys, useDayBatches } from '@entities/plan';
import { getRemainingDayBatches } from '@features/active-roast/lib/remaining-day-batches';
import type { RoastSummaryForm } from '@features/active-roast/lib/roastSummarySchema';
import { formatRoastSaveError } from '@features/active-roast/lib/saveErrorClassification';
import { toPlanBatchHandoff } from '@features/active-roast/lib/toPlanBatchHandoff';
import { type CompletedRoastSnapshot, selectRoastSelection } from '@features/active-roast/model/batch';
import { useBbpStore } from '@features/active-roast/model/bbp';
import {
    clearPendingRoastSave,
    createPendingRoastSave,
    listPendingRoastSaves,
    type PendingRoastParams,
    readPendingRoastSave,
    writePendingRoastSave,
} from '@features/active-roast/model/pendingRoastSave';
import { isChargedPhase, type RoastPhase, useRoastingStore } from '@features/active-roast/model/status';
import { type SaveRoastFormData, useSaveRoast } from '@features/active-roast/model/useSaveRoast';
import { useUploadRoastProfile } from '@features/upload-roast-profile';
import { i18n } from '@shared/i18n';
import { logger } from '@shared/lib/logger';
import { useToastStore } from '@shared/store/toast';
import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import type { LogEntry } from '@shared/types/roast';
import { useQueryClient } from '@tanstack/react-query';
import { message } from '@tauri-apps/plugin-dialog';
import { format } from 'date-fns';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type RoastSummaryData, useRoastCompletionFlow } from './useRoastCompletionFlow';

export interface UseRoastSaveFlowParams {
    rawBT: number | null;
    ambientTemperature?: number | null;
    ambientHumidity?: number | null;
    onResetActiveRoast: () => void;
}

/** After save, load fresh day batches and keep remaining as rows (materialize on select). */
export async function resolveContinueCandidates(params: {
    preferBatchId: string | null;
    fetchDayBatches: () => Promise<PlanBatchWithProgress[]>;
}): Promise<PlanBatchWithProgress[]> {
    const fresh = await params.fetchDayBatches();
    return getRemainingDayBatches(fresh, { preferBatchId: params.preferBatchId });
}

const resolvePendingUserId = (snapshot: CompletedRoastSnapshot, workspaceOwnerId: string | null): string | null => {
    const live = useRoastingStore.getState();
    return snapshot.sessionOwnerId ?? live.sessionOwnerId ?? workspaceOwnerId ?? null;
};

/** Same key variants as `snapshotParams` / cancelDrop may have used when owner was unset. */
const pendingCheckpointUserIds = (snapshot: CompletedRoastSnapshot, workspaceOwnerId: string | null): string[] => {
    const live = useRoastingStore.getState();
    const ids = new Set<string>();
    for (const id of [snapshot.sessionOwnerId, live.sessionOwnerId, workspaceOwnerId]) {
        if (id) ids.add(id);
    }
    if (snapshot.sessionOwnerId == null) ids.add('');
    return [...ids];
};

/** Next Charge already owns the machine — A's save must not mutate it. */
export const isLiveDetachedFromPending = (
    live: { sessionId: string | null; phase: RoastPhase; awaitingNextCharge: boolean },
    pendingSessionId: string | null | undefined,
): boolean =>
    Boolean(live.sessionId && live.sessionId !== pendingSessionId) ||
    Boolean(live.awaitingNextCharge && !isChargedPhase(live.phase));

export const useRoastSaveFlow = (params: UseRoastSaveFlowParams) => {
    const { rawBT, ambientTemperature, ambientHumidity, onResetActiveRoast } = params;
    const planBatchHandoff = useRoastingStore((state) => selectRoastSelection(state).planBatchHandoff);
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const today = format(new Date(), 'yyyy-MM-dd');
    const { data: dayBatches = [] } = useDayBatches(isWorkspaceReady ? workspaceOwnerId : '', today);
    const qc = useQueryClient();

    const flow = useRoastCompletionFlow();
    const { mutateAsync: syncRoastCurve } = useUploadRoastProfile();
    const { resumeSave, isSaving } = useSaveRoast(planBatchHandoff, syncRoastCurve);
    const submitting = useRef(false);
    const [preparing, setPreparing] = useState(false);

    // Everything but the form and log entries is identical between the two snapshots.
    const snapshotParams = useCallback(
        (
            formData: SaveRoastFormData,
            logEntries: LogEntry[],
            snapshot?: CompletedRoastSnapshot | null,
        ): PendingRoastParams => {
            const state = useRoastingStore.getState();
            const selection = selectRoastSelection(state);
            const savedSessionId = snapshot?.sessionId ?? state.sessionId;
            const bbp = useBbpStore.getState().finalized;
            return {
                formData,
                userId: snapshot?.sessionOwnerId ?? useRoastingStore.getState().sessionOwnerId ?? workspaceOwnerId,
                elapsed: snapshot?.elapsed ?? state.elapsed,
                roastStartTime: snapshot?.roastStartMs ?? useRoastingStore.getState().roastStartMs,
                rawBT: snapshot ? snapshot.rawBT : rawBT,
                ambientTemperature,
                ambientHumidity,
                selectedBeanId: snapshot ? snapshot.selection.beanId : selection.beanId,
                targetProfileId: snapshot ? snapshot.selection.profileId : selection.profileId,
                planBatchHandoff: snapshot ? snapshot.selection.planBatchHandoff : selection.planBatchHandoff,
                sessionId: savedSessionId,
                handoffBeanName: snapshot ? snapshot.selection.beanName : selection.beanName,
                logEntries,
                machineSnapshot: snapshot ? snapshot.machineSnapshot : useRoastingStore.getState().machineSnapshot,
                bbpSummary: savedSessionId && bbp?.sessionId === savedSessionId ? bbp : null,
            };
        },
        [workspaceOwnerId, rawBT, ambientTemperature, ambientHumidity],
    );

    const nextStarting = useRef(false);
    const flowEpoch = useRef(0);
    const flowOwner = useRef(workspaceOwnerId);
    useEffect(() => {
        flowOwner.current = workspaceOwnerId;
        return () => {
            flowEpoch.current += 1;
        };
    }, [workspaceOwnerId]);

    const handleSave = useCallback(
        async (formData: RoastSummaryForm) => {
            // isSaving turns true only inside saveRoast — the async F3 guard below
            // leaves the button enabled, so block re-entry here too.
            if (submitting.current || isSaving) return;
            submitting.current = true;
            setPreparing(true);
            const epoch = flowEpoch.current;
            try {
                const frozen = flow.summaryData;
                const completed = useRoastingStore.getState().completed;
                if (!frozen?.sessionId || completed?.snapshot.sessionId !== frozen.sessionId || !completed.summary)
                    return;
                const frozenId = frozen.sessionId;
                const snapshot = completed.snapshot;
                const liveOwner = snapshot.sessionOwnerId ?? workspaceOwnerId;
                const existing = frozenId
                    ? (readPendingRoastSave(liveOwner, frozenId) ??
                      readPendingRoastSave(workspaceOwnerId, frozenId) ??
                      listPendingRoastSaves().find((p) => p.params.sessionId === frozenId) ??
                      null)
                    : null;
                const ownerId = existing?.params.userId ?? liveOwner;
                const frozenHandoff = existing?.params.planBatchHandoff ?? frozen?.planBatchHandoff ?? null;
                let linkedBatch: PlanBatchHandoff | null = null;
                if (!frozenHandoff && formData.linkMode === 'schedule' && formData.planBatchId) {
                    const row = dayBatches.find((b) => b.id === formData.planBatchId);
                    if (row) linkedBatch = toPlanBatchHandoff(row);
                }

                // Durable intent: written BEFORE any auth gate so the roast survives
                // an auth kick to the login screen, a crash, or a force quit.
                // Recovered (auto-saved) by PendingRoastRecovery on next launch.
                const formPatch: SaveRoastFormData = {
                    notes: formData.notes,
                    weightGrams: formData.weightGrams,
                    outputWeightKg: formData.outputWeightKg,
                    roastLevel: formData.roastLevel,
                    beanId: formData.beanId,
                    beanLabel: formData.beanId ? null : formData.beanLabel,
                    linkedBatch,
                    deductStock: formData.deductStock,
                    linkedBatchId: !frozenHandoff && formData.linkMode === 'schedule' ? formData.planBatchId : null,
                };
                const pending = existing
                    ? {
                          ...existing,
                          submitted: true,
                          params: {
                              ...existing.params,
                              formData: { ...existing.params.formData, ...formPatch },
                              logEntries: frozen?.logEntries ?? existing.params.logEntries,
                          },
                      }
                    : createPendingRoastSave(
                          { ...snapshotParams(formPatch, snapshot.logEntries, snapshot), userId: ownerId },
                          true,
                      );
                if (!snapshot.curveRecorded) pending.profile = 'not_required';
                writePendingRoastSave(pending);

                const saveStarted = Date.now();
                const saveResult = await resumeSave(pending);
                logger.debug('roast-save-stage', { stage: 'resume-save', ms: Date.now() - saveStarted });
                const matched = useRoastingStore
                    .getState()
                    .saveSucceeded(pending.params.userId, pending.params.sessionId);
                if (epoch !== flowEpoch.current || flowOwner.current !== workspaceOwnerId || !matched) return;
                if (saveResult.syncPending) {
                    useToastStore.getState().show(i18n.t('activeRoast.recovery.syncPending'), 'info');
                }

                const preferBatchId =
                    saveResult.savedSession.plan_batch_id ??
                    existing?.params.planBatchHandoff?.planBatchId ??
                    planBatchHandoff?.planBatchId ??
                    linkedBatch?.planBatchId ??
                    null;

                flow.onSaveSuccess({
                    shouldOpenContinue: false,
                    ownerId: pending.params.userId,
                    sessionId: pending.params.sessionId,
                });
                setPreparing(false);

                // Drop already released the machine. A's save must not reset B / Charge-wait / handoff.
                const live = useRoastingStore.getState();
                if (isLiveDetachedFromPending(live, pending.params.sessionId)) return;

                let continueCandidates: PlanBatchWithProgress[] = [];
                if (!saveResult.syncPending && isWorkspaceReady && workspaceOwnerId) {
                    const continueStarted = Date.now();
                    try {
                        continueCandidates = await resolveContinueCandidates({
                            preferBatchId,
                            fetchDayBatches: async () => {
                                await qc.invalidateQueries({
                                    queryKey: planKeys.dayBatches(workspaceOwnerId, today),
                                });
                                return qc.fetchQuery({
                                    queryKey: planKeys.dayBatches(workspaceOwnerId, today),
                                    queryFn: () => planBatchApi.listForDateRange(workspaceOwnerId, today, today),
                                });
                            },
                        });
                    } catch (err) {
                        logger.capture(err, { context: 'resolveContinueCandidates' });
                        continueCandidates = [];
                    }
                    logger.debug('roast-save-stage', {
                        stage: 'continue-candidates',
                        ms: Date.now() - continueStarted,
                    });
                }

                if (epoch !== flowEpoch.current || flowOwner.current !== workspaceOwnerId) return;
                if (isLiveDetachedFromPending(useRoastingStore.getState(), pending.params.sessionId)) return;

                if (continueCandidates.length === 0) {
                    useRoastingStore.getState().completeBatch();
                } else {
                    flow.onSaveSuccess({
                        shouldOpenContinue: true,
                        ownerId: pending.params.userId,
                        sessionId: pending.params.sessionId,
                        continueCandidates,
                    });
                }
                onResetActiveRoast();
            } catch (err) {
                logger.capture(err, { context: 'roastSummary save' });
                const detail = formatRoastSaveError(err);
                await message(i18n.t('activeRoast.dialogs.saveFailedMsg', { error: detail }), {
                    title: i18n.t('activeRoast.dialogs.saveFailedTitle'),
                    kind: 'error',
                });
            } finally {
                submitting.current = false;
                setPreparing(false);
            }
        },
        [
            isSaving,
            workspaceOwnerId,
            isWorkspaceReady,
            today,
            qc,
            resumeSave,
            snapshotParams,
            planBatchHandoff,
            dayBatches,
            flow.summaryData,
            flow.onSaveSuccess,
            onResetActiveRoast,
        ],
    );

    // Crash/auth-kick backstop: the roast becomes durable the moment the summary
    // opens, with modal-default form values. Overwritten with the real form on Save.
    const confirmEndRoast = useCallback(
        (summaryData: RoastSummaryData) => {
            const state = useRoastingStore.getState();
            const selection = selectRoastSelection(state);
            const snapshot = state.captureSummary(
                {
                    ...summaryData,
                    sessionId: summaryData.sessionId ?? state.sessionId,
                    elapsedSec: summaryData.elapsedSec ?? state.elapsed,
                    selectedBeanId:
                        summaryData.selectedBeanId !== undefined ? summaryData.selectedBeanId : selection.beanId,
                    handoffBeanName:
                        summaryData.handoffBeanName !== undefined ? summaryData.handoffBeanName : selection.beanName,
                    planBatchHandoff:
                        summaryData.planBatchHandoff !== undefined
                            ? summaryData.planBatchHandoff
                            : selection.planBatchHandoff,
                },
                workspaceOwnerId,
                rawBT,
            );
            const frozen = useRoastingStore.getState().completed?.summary;
            if (!frozen) return;
            const pending = createPendingRoastSave(
                snapshotParams(
                    {
                        notes: '',
                        weightGrams: snapshot.selection.planBatchHandoff?.batchSizeKg ?? 0,
                        roastLevel: null,
                        beanId: snapshot.selection.beanId,
                        beanLabel: null,
                        linkedBatch: null,
                        deductStock: false,
                    },
                    snapshot.logEntries,
                    snapshot,
                ),
                false,
            );
            if (!snapshot.curveRecorded) pending.profile = 'not_required';
            try {
                const existing = readPendingRoastSave(pending.params.userId, pending.params.sessionId);
                if (!existing?.submitted) writePendingRoastSave(pending);
            } catch (err) {
                logger.capture(err, { context: 'confirmEndRoast.pendingCheckpoint' });
                useToastStore.getState().show(formatRoastSaveError(err));
            }
            flow.confirmEndRoast(frozen);
        },
        [workspaceOwnerId, rawBT, snapshotParams, flow.confirmEndRoast],
    );
    const discardSummary = useCallback(() => {
        const completed = useRoastingStore.getState().completed;
        const snapshot = completed?.snapshot;
        const sessionId = flow.summarySessionId ?? flow.summaryData?.sessionId ?? null;
        if (!sessionId || !snapshot || !completed?.summary) {
            logger.warn('discardSummary: no completed summary to discard', {
                context: 'discardSummary',
                sessionId,
            });
            flow.closeSummary();
            return;
        }
        if (snapshot.sessionId !== sessionId) {
            logger.capture(new Error('discardSummary: session mismatch'), {
                context: 'discardSummary',
                snapshotSessionId: snapshot.sessionId,
                requestedSessionId: sessionId,
            });
            useToastStore.getState().show(i18n.t('activeRoast.summary.discardFailed'));
            return;
        }
        const ownerId = resolvePendingUserId(snapshot, workspaceOwnerId);
        const discardOwnerId = ownerId ?? workspaceOwnerId ?? '';
        if (!flow.discardSummary(discardOwnerId || null, sessionId)) {
            logger.capture(new Error('discardSummary: batch store rejected discard'), {
                context: 'discardSummary',
                sessionId,
                ownerId: discardOwnerId,
            });
            useToastStore.getState().show(i18n.t('activeRoast.summary.discardFailed'));
            return;
        }
        try {
            for (const userId of pendingCheckpointUserIds(snapshot, workspaceOwnerId)) {
                clearPendingRoastSave(userId, sessionId);
            }
        } catch (err) {
            logger.capture(err, { context: 'discardSummary.pendingCheckpoint', sessionId });
            useToastStore.getState().show(formatRoastSaveError(err));
        }
    }, [flow, workspaceOwnerId]);

    const handleStartNext = useCallback(
        async (row: PlanBatchWithProgress) => {
            if (nextStarting.current) return;
            nextStarting.current = true;
            const epoch = flowEpoch.current;
            try {
                if (!isWorkspaceReady || !workspaceOwnerId)
                    throw new Error(i18n.t('activeRoast.summary.workspaceLoading'));
                const real = await planBatchApi.startForRoast(workspaceOwnerId, row);
                invalidateScheduledBatchQueries(qc);
                if (epoch !== flowEpoch.current || flowOwner.current !== workspaceOwnerId) return;
                const liveNow = useRoastingStore.getState();
                if (liveNow.sessionId) return;
                useRoastingStore.getState().startBatch(toPlanBatchHandoff(real));
                flow.dismissContinue();
            } catch (err) {
                invalidateScheduledBatchQueries(qc);
                throw err;
            } finally {
                nextStarting.current = false;
            }
        },
        [workspaceOwnerId, isWorkspaceReady, qc, flow.dismissContinue],
    );

    return {
        flow,
        isSaving: isSaving || preparing,
        handleSave,
        handleStartNext,
        confirmEndRoast,
        discardSummary,
    };
};
