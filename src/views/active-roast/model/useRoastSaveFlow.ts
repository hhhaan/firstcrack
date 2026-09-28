import { useActiveWorkspace } from '@entities/organization';
import { invalidateScheduledBatchQueries, planBatchApi, planKeys, useDayBatches } from '@entities/plan';
import { getRemainingDayBatches } from '@features/active-roast/lib/remaining-day-batches';
import type { RoastSummaryForm } from '@features/active-roast/lib/roastSummarySchema';
import { formatRoastSaveError } from '@features/active-roast/lib/saveErrorClassification';
import { toPlanBatchHandoff } from '@features/active-roast/lib/toPlanBatchHandoff';
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
import { useRoastSessionStore } from '@shared/store/roastSession';
import { useToastStore } from '@shared/store/toast';
import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import type { LogEntry } from '@shared/types/roast';
import { useQueryClient } from '@tanstack/react-query';
import { message } from '@tauri-apps/plugin-dialog';
import { format } from 'date-fns';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCompletedRoastStore } from './completedRoast';
import { type RoastSummaryData, useRoastCompletionFlow } from './useRoastCompletionFlow';

export interface UseRoastSaveFlowParams {
    planBatchHandoff: PlanBatchHandoff | null;
    elapsed: number;
    roastStartTimeRef: React.MutableRefObject<number>;
    rawBT: number | null;
    selectedBeanId: string | null;
    targetProfileId: string | null;
    handoffBeanName: string | null;
    sessionId: string | null;
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

/** Next Charge already owns the machine — A's save must not mutate it. */
export const isLiveDetachedFromPending = (
    live: { sessionId: string | null; phase: RoastPhase; awaitingNextCharge: boolean },
    pendingSessionId: string | null | undefined,
): boolean =>
    Boolean(live.sessionId && live.sessionId !== pendingSessionId) ||
    Boolean(live.awaitingNextCharge && !isChargedPhase(live.phase));

export const useRoastSaveFlow = (params: UseRoastSaveFlowParams) => {
    const {
        planBatchHandoff,
        elapsed,
        roastStartTimeRef,
        rawBT,
        selectedBeanId,
        targetProfileId,
        handoffBeanName,
        sessionId,
        ambientTemperature,
        ambientHumidity,
        onResetActiveRoast,
    } = params;

    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const today = format(new Date(), 'yyyy-MM-dd');
    const { data: dayBatches = [] } = useDayBatches(isWorkspaceReady ? workspaceOwnerId : '', today);
    const qc = useQueryClient();

    const flow = useRoastCompletionFlow();
    const { mutateAsync: syncRoastCurve } = useUploadRoastProfile();
    const { resumeSave, isSaving } = useSaveRoast(planBatchHandoff, syncRoastCurve);
    const submitting = useRef(false);
    const [preparing, setPreparing] = useState(false);
    const unrecordedId = useRef<string | null>(null);

    // Everything but the form and log entries is identical between the two snapshots.
    const snapshotParams = useCallback(
        (formData: SaveRoastFormData, logEntries: LogEntry[]): PendingRoastParams => ({
            formData,
            userId: useRoastingStore.getState().sessionOwnerId ?? workspaceOwnerId,
            elapsed,
            roastStartTime: roastStartTimeRef.current,
            rawBT,
            ambientTemperature,
            ambientHumidity,
            selectedBeanId,
            targetProfileId,
            planBatchHandoff,
            sessionId,
            handoffBeanName,
            logEntries,
            machineSnapshot: useRoastingStore.getState().machineSnapshot,
            bbpSummary:
                sessionId && useBbpStore.getState().finalized?.sessionId === sessionId
                    ? useBbpStore.getState().finalized
                    : null,
        }),
        [
            workspaceOwnerId,
            elapsed,
            roastStartTimeRef,
            rawBT,
            ambientTemperature,
            ambientHumidity,
            selectedBeanId,
            targetProfileId,
            planBatchHandoff,
            sessionId,
            handoffBeanName,
        ],
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
                const frozenId = frozen?.sessionId ?? sessionId ?? unrecordedId.current;
                const liveOwner = useRoastingStore.getState().sessionOwnerId ?? workspaceOwnerId;
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
                          frozen
                              ? {
                                    ...snapshotParams(formPatch, frozen.logEntries),
                                    sessionId: frozen.sessionId ?? null,
                                    elapsed: frozen.elapsedSec ?? 0,
                                    selectedBeanId: frozen.selectedBeanId ?? null,
                                    planBatchHandoff: frozen.planBatchHandoff ?? null,
                                    handoffBeanName: frozen.handoffBeanName ?? null,
                                    targetProfileId: null,
                                    roastStartTime: 0,
                                    rawBT: null,
                                    machineSnapshot: null,
                                    bbpSummary: null,
                                    userId: ownerId,
                                }
                              : snapshotParams(formPatch, []),
                          true,
                      );
                if (!pending.params.sessionId) pending.params.sessionId = unrecordedId.current ??= crypto.randomUUID();
                writePendingRoastSave(pending);

                const saveStarted = Date.now();
                const saveResult = await resumeSave(pending);
                logger.debug('roast-save-stage', { stage: 'resume-save', ms: Date.now() - saveStarted });
                if (epoch !== flowEpoch.current || flowOwner.current !== workspaceOwnerId) return;
                if (saveResult.syncPending) {
                    useToastStore.getState().show(i18n.t('activeRoast.recovery.syncPending'), 'info');
                }

                const preferBatchId =
                    saveResult.savedSession.plan_batch_id ??
                    existing?.params.planBatchHandoff?.planBatchId ??
                    planBatchHandoff?.planBatchId ??
                    linkedBatch?.planBatchId ??
                    null;

                flow.onSaveSuccess({ shouldOpenContinue: false });
                unrecordedId.current = null;
                setPreparing(false);
                useCompletedRoastStore.getState().markSubmitted(pending.params.sessionId);

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
                    useRoastSessionStore.getState().completeBatch();
                } else {
                    flow.onSaveSuccess({
                        shouldOpenContinue: true,
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
            sessionId,
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
            const frozen: RoastSummaryData = {
                ...summaryData,
                sessionId: summaryData.sessionId ?? sessionId,
                selectedBeanId: summaryData.selectedBeanId ?? selectedBeanId,
                planBatchHandoff: summaryData.planBatchHandoff ?? planBatchHandoff,
                handoffBeanName: summaryData.handoffBeanName ?? handoffBeanName,
            };
            const pending = createPendingRoastSave(
                {
                    ...snapshotParams(
                        {
                            notes: '',
                            weightGrams: frozen.planBatchHandoff?.batchSizeKg ?? 0,
                            roastLevel: null,
                            beanId: frozen.selectedBeanId ?? null,
                            beanLabel: null,
                            linkedBatch: null,
                            deductStock: false,
                        },
                        frozen.logEntries,
                    ),
                    sessionId: frozen.sessionId ?? sessionId,
                    selectedBeanId: frozen.selectedBeanId ?? null,
                    planBatchHandoff: frozen.planBatchHandoff ?? null,
                    handoffBeanName: frozen.handoffBeanName ?? null,
                },
                false,
            );
            if (!pending.params.sessionId) pending.params.sessionId = unrecordedId.current ??= pending.params.sessionId;
            frozen.sessionId = pending.params.sessionId;
            pending.params.elapsed = frozen.elapsedSec ?? pending.params.elapsed;
            try {
                const existing = readPendingRoastSave(pending.params.userId, pending.params.sessionId);
                if (!existing?.submitted) writePendingRoastSave(pending);
            } catch (err) {
                logger.capture(err, { context: 'confirmEndRoast.pendingCheckpoint' });
                useToastStore.getState().show(formatRoastSaveError(err));
            }
            flow.confirmEndRoast(frozen);
        },
        [snapshotParams, planBatchHandoff, selectedBeanId, sessionId, handoffBeanName, flow.confirmEndRoast],
    );

    const discardSummary = useCallback(() => {
        const id = flow.summaryData?.sessionId ?? sessionId ?? unrecordedId.current;
        if (id) clearPendingRoastSave(useRoastingStore.getState().sessionOwnerId ?? workspaceOwnerId, id);
        unrecordedId.current = null;
        flow.discardSummary();
    }, [flow.discardSummary, flow.summaryData?.sessionId, sessionId, workspaceOwnerId]);

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
                useRoastSessionStore.getState().startBatch(toPlanBatchHandoff(real));
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
