import { beanStockEventApi } from '@entities/bean-stock-event';
import { useActiveWorkspace } from '@entities/organization';
import { planBatchApi, planKeys, useDayBatches } from '@entities/plan';
import { getRemainingDayBatches } from '@features/active-roast/lib/remaining-day-batches';
import type { RoastSummaryForm } from '@features/active-roast/lib/roastSummarySchema';
import { pgErrorCode } from '@features/active-roast/lib/saveErrorClassification';
import { toPlanBatchHandoff } from '@features/active-roast/lib/toPlanBatchHandoff';
import {
    clearPendingRoastSave,
    type PendingRoastParams,
    type PendingRoastSave,
    readPendingRoastSave,
    toSaveRoastParams,
    writePendingRoastSave,
} from '@features/active-roast/model/pendingRoastSave';
import { useRoastingStore } from '@features/active-roast/model/status';
import { type SaveRoastFormData, useSaveRoast } from '@features/active-roast/model/useSaveRoast';
import { useUploadRoastProfile } from '@features/upload-roast-profile';
import { i18n } from '@shared/i18n';
import { ensureSession } from '@shared/lib/ensureSession';
import { isGreenRoastAlreadyClaimed } from '@shared/lib/f3-green-deduct';
import { BatchLimitError } from '@shared/lib/features';
import { logger } from '@shared/lib/logger';
import { useRoastSessionStore } from '@shared/store/roastSession';
import { useToastStore } from '@shared/store/toast';
import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import type { LogEntry } from '@shared/types/roast';
import { useQueryClient } from '@tanstack/react-query';
import { message } from '@tauri-apps/plugin-dialog';
import { format } from 'date-fns';
import { useCallback } from 'react';
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

/** After save, load fresh day batches and map remaining → handoffs. */
export async function resolveContinueCandidates(params: {
    preferBatchId: string | null;
    fetchDayBatches: () => Promise<PlanBatchWithProgress[]>;
}): Promise<PlanBatchHandoff[]> {
    const fresh = await params.fetchDayBatches();
    const remaining = getRemainingDayBatches(fresh, { preferBatchId: params.preferBatchId });
    return remaining.map(toPlanBatchHandoff);
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
    const { saveRoast, isSaving } = useSaveRoast(planBatchHandoff, syncRoastCurve);

    // Everything but the form and log entries is identical between the two snapshots.
    const snapshotParams = useCallback(
        (formData: SaveRoastFormData, logEntries: LogEntry[]): PendingRoastParams => ({
            formData,
            userId: workspaceOwnerId,
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

    const handleSave = useCallback(
        async (formData: RoastSummaryForm) => {
            // isSaving turns true only inside saveRoast — the async F3 guard below
            // leaves the button enabled, so block re-entry here too.
            if (isSaving) return;
            try {
                let linkedBatch: PlanBatchHandoff | null = null;
                if (!planBatchHandoff && formData.linkMode === 'schedule' && formData.planBatchId) {
                    const row = dayBatches.find((b) => b.id === formData.planBatchId);
                    if (!row || row.completed_sessions >= row.batch_count) {
                        throw new Error(i18n.t('activeRoast.summary.batchUnavailable'));
                    }
                    linkedBatch = toPlanBatchHandoff(row);
                }

                // F3 UX: warn if schedule already deducted this batch; server also skips (C2).
                let deductStock = formData.deductStock;
                const guardBatchId = planBatchHandoff?.planBatchId ?? linkedBatch?.planBatchId ?? null;
                if (deductStock && guardBatchId) {
                    try {
                        const batchClaimed = await beanStockEventApi.hasRoastDeductionForReference(guardBatchId);
                        if (
                            isGreenRoastAlreadyClaimed(
                                batchClaimed ? [guardBatchId] : [],
                                sessionId ?? '',
                                guardBatchId,
                            )
                        ) {
                            deductStock = false;
                            await message(i18n.t('activeRoast.summary.deductSkippedAlreadyDeducted'), {
                                title: '재고 차감',
                                kind: 'warning',
                            });
                        }
                    } catch (err) {
                        logger.capture(err, { context: 'stockDeduct guard' });
                    }
                }

                // Durable intent: written BEFORE any auth gate so the roast survives
                // an auth kick to the login screen, a crash, or a force quit.
                // Recovered (auto-saved) by PendingRoastRecovery on next launch.
                const pending: PendingRoastSave = {
                    version: 1,
                    submitted: true,
                    params: snapshotParams(
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
                            deductStock,
                        },
                        flow.summaryData?.logEntries ?? [],
                    ),
                };
                writePendingRoastSave(pending);

                // Second chance before failing: revive a session whose auto-refresh
                // was missed (sleep / long background) without forcing a re-login.
                if (!(await ensureSession())) {
                    throw new Error(i18n.t('activeRoast.summary.sessionExpired'));
                }

                const saveResult = await saveRoast(toSaveRoastParams(pending.params));
                clearPendingRoastSave();

                if (saveResult.batchStatusUpdateFailed) {
                    useToastStore.getState().show(i18n.t('activeRoast.summary.batchStatusUpdateFailed'));
                }

                const preferBatchId = planBatchHandoff?.planBatchId ?? linkedBatch?.planBatchId ?? null;

                let continueCandidates: PlanBatchHandoff[] = [];
                if (isWorkspaceReady && workspaceOwnerId) {
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
                }

                // 남은 배치가 없으면 Continue 모달이 안 열려 핸드오프 해제 기회가 없다 —
                // 여기서 떼지 않으면 다음 애드혹 로스트가 끝난 배치에 붙는다 (#317)
                if (continueCandidates.length === 0) {
                    useRoastSessionStore.getState().completeBatch();
                }

                flow.onSaveSuccess({
                    shouldOpenContinue: continueCandidates.length > 0,
                    continueCandidates,
                });
                onResetActiveRoast();
            } catch (err) {
                logger.capture(err, { context: 'roastSummary save' });
                // FK on deleted bean — surface a clear action instead of raw PostgREST text (#176)
                const pgCode = pgErrorCode(err);
                if (pgCode === '23503') {
                    // Same reasoning as 23514 below — the snapshot would only be replayed
                    // (and then discarded) by PendingRoastRecovery, so the open modal is
                    // the single recovery route.
                    clearPendingRoastSave();
                    await message(i18n.t('activeRoast.dialogs.beanDeletedMsg'), {
                        title: i18n.t('activeRoast.dialogs.beanDeletedTitle'),
                        kind: 'error',
                    });
                    return;
                }
                // Check violation — in practice output_weight_grams <= weight_grams (#181).
                // The same payload fails forever, so drop the pending snapshot instead of
                // letting PendingRoastRecovery replay it on every launch. Safe: the summary
                // modal stays open (nothing here resets the flow), and a corrected re-save
                // rewrites the snapshot before hitting the server.
                if (pgCode === '23514') {
                    clearPendingRoastSave();
                    await message(i18n.t('activeRoast.dialogs.invalidWeightMsg'), {
                        title: i18n.t('activeRoast.dialogs.invalidWeightTitle'),
                        kind: 'error',
                    });
                    return;
                }
                const detail =
                    err instanceof BatchLimitError
                        ? i18n.t(`planGate.${err.code}`, { used: err.used, max: err.max })
                        : err instanceof Error
                          ? err.message
                          : String(err);
                await message(i18n.t('activeRoast.dialogs.saveFailedMsg', { error: detail }), {
                    title: i18n.t('activeRoast.dialogs.saveFailedTitle'),
                    kind: 'error',
                });
            }
        },
        [
            isSaving,
            workspaceOwnerId,
            isWorkspaceReady,
            today,
            qc,
            saveRoast,
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
            // 이전 로스트의 저장 실패 스냅샷(submitted:true)을 덮어쓰지 않는다 (#317).
            // 이 경우 슬롯은 이전 로스트 소유 — discardSummary도 건드리지 않는다.
            const pending = readPendingRoastSave();
            if (pending?.submitted && pending.params.sessionId !== sessionId) {
                flow.confirmEndRoast(summaryData);
                return;
            }
            writePendingRoastSave({
                version: 1,
                submitted: false,
                params: snapshotParams(
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
            });
            flow.confirmEndRoast(summaryData);
        },
        [snapshotParams, planBatchHandoff, selectedBeanId, sessionId, flow.confirmEndRoast],
    );

    const discardSummary = useCallback(() => {
        // 다른 세션의 submitted:true 슬롯은 이전 로스트의 복구 데이터 — 폐기 대상이 아니다 (#317)
        const pending = readPendingRoastSave();
        if (!pending?.submitted || pending.params.sessionId === sessionId) clearPendingRoastSave();
        flow.discardSummary();
    }, [flow.discardSummary, sessionId]);

    return {
        flow,
        isSaving,
        handleSave,
        confirmEndRoast,
        discardSummary,
    };
};
