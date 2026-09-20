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
    type PendingRoastParams,
    readPendingRoastSave,
    writePendingRoastSave,
} from '@features/active-roast/model/pendingRoastSave';
import { useRoastingStore } from '@features/active-roast/model/status';
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
                useBbpStore.getState().finalized?.sessionId === sessionId ? useBbpStore.getState().finalized : null,
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
                let linkedBatch: PlanBatchHandoff | null = null;
                if (!planBatchHandoff && formData.linkMode === 'schedule' && formData.planBatchId) {
                    const row = dayBatches.find((b) => b.id === formData.planBatchId);
                    if (row) linkedBatch = toPlanBatchHandoff(row);
                }

                // Durable intent: written BEFORE any auth gate so the roast survives
                // an auth kick to the login screen, a crash, or a force quit.
                // Recovered (auto-saved) by PendingRoastRecovery on next launch.
                const pending = createPendingRoastSave(
                    snapshotParams(
                        {
                            notes: formData.notes,
                            weightGrams: formData.weightGrams,
                            outputWeightKg: formData.outputWeightKg,
                            roastLevel: formData.roastLevel,
                            beanId: formData.beanId,
                            beanLabel: formData.beanId ? null : formData.beanLabel,
                            linkedBatch,
                            // ponytail: no beanId gate here — saveRoastCore's canTouchStock
                            // (resolvedBeanId || blendId) already blocks label-only sessions,
                            // and gating on beanId silently killed blend/handoff deduction.
                            deductStock: formData.deductStock,
                            linkedBatchId:
                                !planBatchHandoff && formData.linkMode === 'schedule' ? formData.planBatchId : null,
                        },
                        flow.summaryData?.logEntries ?? [],
                    ),
                    true,
                );
                if (!sessionId) pending.params.sessionId = unrecordedId.current ??= pending.params.sessionId;
                writePendingRoastSave(pending);

                const saveStarted = Date.now();
                const saveResult = await resumeSave(pending);
                logger.debug('roast-save-stage', { stage: 'resume-save', ms: Date.now() - saveStarted });
                if (epoch !== flowEpoch.current || flowOwner.current !== workspaceOwnerId) return;
                if (saveResult.syncPending) {
                    useToastStore.getState().show(i18n.t('activeRoast.recovery.syncPending'));
                }

                const preferBatchId =
                    saveResult.savedSession.plan_batch_id ??
                    planBatchHandoff?.planBatchId ??
                    linkedBatch?.planBatchId ??
                    null;

                // Close save UI now. Keep the ended roast until continue candidates
                // have fresh progress so we cannot start the wrong next batch (#317).
                flow.onSaveSuccess({ shouldOpenContinue: false });
                unrecordedId.current = null;
                setPreparing(false);

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

                // 남은 배치가 없으면 Continue 모달이 안 열려 핸드오프 해제 기회가 없다 —
                // 여기서 떼지 않으면 다음 애드혹 로스트가 끝난 배치에 붙는다 (#317)
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
            const pending = createPendingRoastSave(
                snapshotParams(
                    {
                        notes: '',
                        weightGrams: planBatchHandoff?.batchSizeKg ?? 0,
                        roastLevel: null,
                        beanId: selectedBeanId,
                        beanLabel: null,
                        linkedBatch: null,
                        deductStock: false,
                    },
                    summaryData.logEntries,
                ),
                false,
            );
            if (!sessionId) pending.params.sessionId = unrecordedId.current ??= pending.params.sessionId;
            try {
                const existing = readPendingRoastSave(pending.params.userId, pending.params.sessionId);
                if (!existing?.submitted) writePendingRoastSave(pending);
            } catch (err) {
                useToastStore.getState().show(formatRoastSaveError(err));
            }
            flow.confirmEndRoast(summaryData);
        },
        [snapshotParams, planBatchHandoff, selectedBeanId, sessionId, flow.confirmEndRoast],
    );

    const discardSummary = useCallback(() => {
        const id = sessionId ?? unrecordedId.current;
        if (id) clearPendingRoastSave(useRoastingStore.getState().sessionOwnerId ?? workspaceOwnerId, id);
        unrecordedId.current = null;
        flow.discardSummary();
    }, [flow.discardSummary, sessionId, workspaceOwnerId]);

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
