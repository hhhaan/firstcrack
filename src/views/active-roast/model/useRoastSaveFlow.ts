import { useActiveWorkspace } from '@entities/organization';
import { invalidateScheduledBatchQueries, planBatchApi, planKeys, useDayBatches } from '@entities/plan';
import { getRemainingDayBatches } from '@features/active-roast/lib/remaining-day-batches';
import type { RoastSummaryForm } from '@features/active-roast/lib/roastSummarySchema';
import { formatRoastSaveError } from '@features/active-roast/lib/saveErrorClassification';
import { toPlanBatchHandoff } from '@features/active-roast/lib/toPlanBatchHandoff';
import { useBbpStore } from '@features/active-roast/model/bbp';
import { completedKey } from '@features/active-roast/model/completed';
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
import { formatElapsed } from '@shared/lib/format';
import { logger } from '@shared/lib/logger';
import { useRoastSessionStore } from '@shared/store/roastSession';
import { useToastStore } from '@shared/store/toast';
import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import type { LogEntry } from '@shared/types/roast';
import { useQueryClient } from '@tanstack/react-query';
import { message } from '@tauri-apps/plugin-dialog';
import { format } from 'date-fns';
import { useCallback, useEffect, useRef } from 'react';
import { type RoastSummaryData, useRoastCompletionFlow } from './useRoastCompletionFlow';

export interface UseRoastSaveFlowParams {
    planBatchHandoff: PlanBatchHandoff | null;
    elapsed: number;
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
    const { resumeSave } = useSaveRoast(planBatchHandoff, syncRoastCurve);
    const records = useRoastingStore((s) => s.completedRecords);
    const summaryKey = flow.summaryData?.sessionId
        ? completedKey(flow.summaryData.sessionOwnerId ?? workspaceOwnerId, flow.summaryData.sessionId)
        : null;
    const isSaving = summaryKey ? Boolean(records[summaryKey]?.saving) : false;
    const oldestUnsaved =
        Object.values(records)
            .filter((r) => r.ownerId === workspaceOwnerId && !r.submitted && r.summary)
            .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;

    // Re-entry restores only checkpoint-owned data. No current-batch fallback.
    useEffect(() => {
        if (!isWorkspaceReady || !workspaceOwnerId) return;
        try {
            for (const pending of listPendingRoastSaves()) {
                const p = pending.params;
                if (p.userId !== workspaceOwnerId || !p.sessionId || pending.submitted) continue;
                useRoastingStore.getState().hydrateCompleted(
                    {
                        sessionId: p.sessionId,
                        sessionOwnerId: p.userId,
                        totalTime: formatElapsed(p.elapsed),
                        development: '—',
                        finalBt: p.rawBT == null ? '—' : String(p.rawBT),
                        logEntries: p.logEntries,
                        elapsedSec: p.elapsed,
                        selectedBeanId: p.selectedBeanId,
                        planBatchHandoff: p.planBatchHandoff,
                        handoffBeanName: p.handoffBeanName,
                    },
                    p,
                );
            }
        } catch (err) {
            logger.capture(err, { context: 'hydrate completed roast' });
        }
    }, [isWorkspaceReady, workspaceOwnerId]);
    const unrecordedId = useRef<string | null>(null);

    // Everything but the form and log entries is identical between the two snapshots.
    const snapshotParams = useCallback(
        (formData: SaveRoastFormData, logEntries: LogEntry[]): PendingRoastParams => ({
            formData,
            userId: useRoastingStore.getState().sessionOwnerId ?? workspaceOwnerId,
            elapsed,
            roastStartTime: useRoastingStore.getState().roastStartMs,
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
        if (flowOwner.current !== workspaceOwnerId) flow.resetFlow();
        flowOwner.current = workspaceOwnerId;
        return () => {
            flowEpoch.current += 1;
        };
    }, [workspaceOwnerId, flow.resetFlow]);

    const handleSave = useCallback(
        async (formData: RoastSummaryForm) => {
            // isSaving turns true only inside saveRoast — the async F3 guard below
            // leaves the button enabled, so block re-entry here too.
            const frozen = flow.summaryData;
            if (!frozen?.sessionId) return;
            const ownerId = frozen.sessionOwnerId ?? workspaceOwnerId;
            const key = completedKey(ownerId, frozen.sessionId);
            const record = useRoastingStore.getState().completedRecords[key];
            if (!record || !useRoastingStore.getState().beginCompletedSave(key)) return;
            const epoch = flowEpoch.current;
            try {
                const frozenId = frozen.sessionId;
                const existing =
                    readPendingRoastSave(ownerId, frozenId) ??
                    (record.params ? createPendingRoastSave(record.params, false) : null);
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
                if (!existing) throw new Error('Completed roast snapshot is unavailable');
                const pending = {
                    ...existing,
                    submitted: true,
                    params: {
                        ...existing.params,
                        formData: { ...existing.params.formData, ...formPatch },
                        logEntries: record.summary?.logEntries ?? existing.params.logEntries,
                    },
                };
                if (!pending.params.sessionId) pending.params.sessionId = unrecordedId.current ??= crypto.randomUUID();
                writePendingRoastSave(pending);

                const saveStarted = Date.now();
                const saveResult = await resumeSave(pending);
                logger.debug('roast-save-stage', { stage: 'resume-save', ms: Date.now() - saveStarted });
                useRoastingStore.getState().markSubmitted(pending.params.sessionId, ownerId);
                if (epoch !== flowEpoch.current || flowOwner.current !== workspaceOwnerId) return;
                if (saveResult.syncPending) {
                    useToastStore.getState().show(i18n.t('activeRoast.recovery.syncPending'), 'info');
                }

                const preferBatchId =
                    saveResult.savedSession.plan_batch_id ??
                    existing?.params.planBatchHandoff?.planBatchId ??
                    pending.params.planBatchHandoff?.planBatchId ??
                    linkedBatch?.planBatchId ??
                    null;

                flow.onSaveSuccess({
                    shouldOpenContinue: false,
                    sessionId: pending.params.sessionId,
                    sessionOwnerId: ownerId,
                });
                unrecordedId.current = null;

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
                        sessionId: pending.params.sessionId,
                        sessionOwnerId: ownerId,
                        continueCandidates,
                    });
                }
                onResetActiveRoast();
            } catch (err) {
                logger.capture(err, { context: 'roastSummary save' });
                if (epoch !== flowEpoch.current || flowOwner.current !== workspaceOwnerId) return;
                const detail = formatRoastSaveError(err);
                await message(i18n.t('activeRoast.dialogs.saveFailedMsg', { error: detail }), {
                    title: i18n.t('activeRoast.dialogs.saveFailedTitle'),
                    kind: 'error',
                });
            } finally {
                useRoastingStore.getState().finishCompletedSave(key);
            }
        },
        [
            workspaceOwnerId,
            isWorkspaceReady,
            today,
            qc,
            resumeSave,
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
                sessionOwnerId:
                    summaryData.sessionOwnerId ?? useRoastingStore.getState().sessionOwnerId ?? workspaceOwnerId,
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
                    userId: frozen.sessionOwnerId ?? workspaceOwnerId,
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
            useRoastingStore.getState().freezeCompleted(frozen, pending.params);
            flow.confirmEndRoast(frozen);
        },
        [
            snapshotParams,
            planBatchHandoff,
            selectedBeanId,
            sessionId,
            handoffBeanName,
            workspaceOwnerId,
            flow.confirmEndRoast,
        ],
    );

    const discardSummary = useCallback(() => {
        const summary = flow.summaryData;
        if (!summary?.sessionId) return;
        const owner = summary.sessionOwnerId ?? workspaceOwnerId;
        const key = completedKey(owner, summary.sessionId);
        if (!useRoastingStore.getState().discardCompleted(key)) return;
        clearPendingRoastSave(owner, summary.sessionId);
        unrecordedId.current = null;
        flow.discardSummary();
    }, [flow.discardSummary, flow.summaryData, workspaceOwnerId]);

    const reopenOldestUnsaved = useCallback(() => {
        if (oldestUnsaved?.summary) flow.confirmEndRoast(oldestUnsaved.summary);
    }, [oldestUnsaved, flow.confirmEndRoast]);

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
        isSaving,
        oldestUnsaved,
        reopenOldestUnsaved,
        handleSave,
        handleStartNext,
        confirmEndRoast,
        discardSummary,
    };
};
