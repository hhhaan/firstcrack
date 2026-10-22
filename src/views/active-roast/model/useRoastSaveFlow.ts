import { useActiveWorkspace } from '@entities/organization';
import { dayBatchesQuery, invalidateScheduledBatchQueries, planKeys, useDayBatches } from '@entities/plan';
import { getRemainingDayBatches } from '@features/active-roast/lib/remaining-day-batches';
import type { RoastSummaryForm } from '@features/active-roast/lib/roastSummarySchema';
import { formatRoastSaveError } from '@features/active-roast/lib/saveErrorClassification';
import { startSelectedContinueBatch } from '@features/active-roast/lib/startNextFromContinue';
import { toPlanBatchHandoff } from '@features/active-roast/lib/toPlanBatchHandoff';
import { type CompletedRoastSnapshot, selectRoastSelection } from '@features/active-roast/model/batch';
import { useBbpStore } from '@features/active-roast/model/bbp';
import { discardReceiptSession } from '@features/active-roast/model/controlReceiptCollector';
import {
    clearPendingRoastSave,
    createPendingRoastSave,
    listPendingRoastSaves,
    type PendingRoastParams,
    readPendingRoastSave,
    writePendingRoastSave,
} from '@features/active-roast/model/pendingRoastSave';
import { getRoastSettings } from '@features/active-roast/model/settings';
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
    /**
     * `null` forces an empty saved profile. `undefined` keeps the batch selection.
     * A history target is not a registered profile, so the summary profile stays blank.
     * Saving the last history-or-profile choice as the used profile is deferred.
     */
    savedProfileId?: () => string | null | undefined;
}

/** After save, load fresh day batches and keep remaining as rows (materialize on select). */
export async function resolveContinueCandidates(params: {
    preferBatchId: string | null;
    fetchDayBatches: () => Promise<PlanBatchWithProgress[]>;
}): Promise<PlanBatchWithProgress[]> {
    const fresh = await params.fetchDayBatches();
    return getRemainingDayBatches(fresh, { preferBatchId: params.preferBatchId });
}

/** Next Charge already owns the machine — A's save must not mutate it. */
export const isLiveDetachedFromPending = (
    live: { sessionId: string | null; phase: RoastPhase; awaitingNextCharge: boolean },
    pendingSessionId: string | null | undefined,
): boolean =>
    Boolean(live.sessionId && live.sessionId !== pendingSessionId) ||
    Boolean(live.awaitingNextCharge && !isChargedPhase(live.phase));

export const useRoastSaveFlow = (params: UseRoastSaveFlowParams) => {
    const { rawBT, ambientTemperature, ambientHumidity, onResetActiveRoast, savedProfileId } = params;
    const savedProfileIdRef = useRef(savedProfileId);
    useEffect(() => {
        savedProfileIdRef.current = savedProfileId;
    }, [savedProfileId]);
    const planBatchHandoff = useRoastingStore((state) => selectRoastSelection(state).planBatchHandoff);
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const today = format(new Date(), 'yyyy-MM-dd');
    const { data: dayBatches = [] } = useDayBatches(isWorkspaceReady ? workspaceOwnerId : '', today);
    const qc = useQueryClient();

    const flow = useRoastCompletionFlow();
    const summaryOwnerId = useRoastingStore((state) => state.completed?.snapshot.sessionOwnerId ?? null);
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
            const forcedProfileId = savedProfileIdRef.current?.();
            const identity = (snapshot?.selection ?? selection).identity;
            const profileId =
                forcedProfileId !== undefined ? forcedProfileId : (snapshot?.selection ?? selection).profileId;
            return {
                formData: { ...formData, batchName: formData.batchName?.trim() || snapshot?.selection.identity?.title },
                userId: snapshot?.sessionOwnerId ?? useRoastingStore.getState().sessionOwnerId ?? workspaceOwnerId,
                elapsed: snapshot?.elapsed ?? state.elapsed,
                roastStartTime: snapshot?.roastStartMs ?? useRoastingStore.getState().roastStartMs,
                rawBT: snapshot ? snapshot.rawBT : rawBT,
                ambientTemperature,
                ambientHumidity,
                selectedBlendId: (snapshot ? snapshot.selection.blendId : selection.blendId) ?? null,
                selectedBeanId: snapshot ? snapshot.selection.beanId : selection.beanId,
                targetProfileId: profileId,
                batchTitleNumbering: identity?.edited ? 'none' : getRoastSettings().batchTitleNumbering,
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
                const recordingPending = () => {
                    const completed = useRoastingStore.getState().completed;
                    const recording = completed?.snapshot;
                    return (
                        Boolean(completed?.summary) &&
                        !completed?.submitted &&
                        recording?.sessionId === frozen?.sessionId &&
                        (recording?.chargeRequestPending || Boolean(recording?.unalignedChargePoints?.length))
                    );
                };
                if (recordingPending()) {
                    await new Promise<void>((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            unsubscribe();
                            reject(new Error(i18n.t('activeRoast.dialogs.chargeRecordingPending')));
                        }, 10_000);
                        const unsubscribe = useRoastingStore.subscribe(() => {
                            if (recordingPending()) return;
                            clearTimeout(timeout);
                            unsubscribe();
                            resolve();
                        });
                    });
                }
                if (epoch !== flowEpoch.current || flowOwner.current !== workspaceOwnerId) return;
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
                    batchName: formData.batchName?.trim() || snapshot.selection.identity?.title,
                    weightGrams: formData.weightGrams,
                    outputWeightKg: formData.outputWeightKg,
                    roastLevel: formData.roastLevel,
                    beanId: formData.beanId,
                    blendId: formData.blendId ?? null,
                    beanLabel: formData.beanId ? null : formData.beanLabel,
                    linkedBatch,
                    deductStock: formData.deductStock,
                    linkedBatchId: !frozenHandoff && formData.linkMode === 'schedule' ? formData.planBatchId : null,
                };
                const forcedProfileId = savedProfileIdRef.current?.();
                const baseParams = existing?.params ?? snapshotParams(formPatch, snapshot.logEntries, snapshot);
                const mergedParams: PendingRoastParams = {
                    ...baseParams,
                    userId: ownerId,
                    formData: { ...baseParams.formData, ...formPatch },
                    logEntries: frozen?.logEntries ?? baseParams.logEntries,
                    batchTitleNumbering:
                        snapshot.selection.identity?.edited ||
                        (formData.batchName?.trim() && formData.batchName.trim() !== snapshot.selection.identity?.title)
                            ? 'none'
                            : (baseParams.batchTitleNumbering ?? getRoastSettings().batchTitleNumbering),
                    ...(forcedProfileId !== undefined && { targetProfileId: forcedProfileId }),
                };
                const pending = existing
                    ? { ...existing, submitted: true, params: mergedParams }
                    : createPendingRoastSave(mergedParams, true);
                if (!snapshot.curveRecorded) pending.profile = 'not_required';
                writePendingRoastSave(pending);

                const saveStarted = Date.now();
                const saveResult = await resumeSave(pending);
                logger.debug('roast-save-stage', { stage: 'resume-save', ms: Date.now() - saveStarted });
                if (saveResult.savedSession.batch_name)
                    useRoastingStore
                        .getState()
                        .replaceReviewTitle(
                            pending.params.sessionId ?? '',
                            pending.params.userId,
                            saveResult.savedSession.batch_name,
                        );
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
                                return qc.fetchQuery(dayBatchesQuery(workspaceOwnerId, today));
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
                if (epoch !== flowEpoch.current || flowOwner.current !== workspaceOwnerId) return;
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
                        blendId: snapshot.selection.blendId ?? null,
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
        const sessionId = flow.summaryData?.sessionId;
        const completed = useRoastingStore.getState().completed;
        if (
            !sessionId ||
            completed?.snapshot.sessionId !== sessionId ||
            completed.snapshot.sessionOwnerId !== summaryOwnerId
        )
            return;
        clearPendingRoastSave(summaryOwnerId ?? workspaceOwnerId, sessionId);
        discardReceiptSession(sessionId);
        flow.discardSummary(summaryOwnerId, sessionId);
    }, [flow.discardSummary, flow.summaryData?.sessionId, summaryOwnerId, workspaceOwnerId]);

    const handleStartNext = useCallback(
        async (row: PlanBatchWithProgress) => {
            if (nextStarting.current) return;
            nextStarting.current = true;
            const epoch = flowEpoch.current;
            try {
                if (!isWorkspaceReady || !workspaceOwnerId)
                    throw new Error(i18n.t('activeRoast.summary.workspaceLoading'));
                const handoff = await startSelectedContinueBatch(workspaceOwnerId, row);
                invalidateScheduledBatchQueries(qc);
                if (epoch !== flowEpoch.current || flowOwner.current !== workspaceOwnerId) return;
                const liveNow = useRoastingStore.getState();
                if (liveNow.sessionId) return;
                useRoastingStore.getState().startBatch(handoff);
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
