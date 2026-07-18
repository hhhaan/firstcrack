import { beanKeys } from '@entities/bean/queries';
import { useActiveWorkspace } from '@entities/organization';
import { useUpdateSingleBatch } from '@entities/plan';
import { type RoastSessionInsert, roastSessionApi, useCreateRoastSession } from '@entities/roast';
import { determineStockDeduction } from '@features/active-roast/lib/determine-stock-deduction';
import { serializeRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { useBbpStore } from '@features/active-roast/model/bbp';
import { BatchLimitError, canCompleteBatch, planMaxBatchesPerMonth } from '@shared/lib/features';
import { logger } from '@shared/lib/logger';
import { useAuthStore } from '@shared/store/auth';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { Bean, PlanBatchHandoff } from '@shared/types/database.types';
import type { LogEntry } from '@shared/types/roast';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

/** Injected from upload feature (composed in views) — avoids feature→feature import. */
export type SyncRoastCurve = (input: { sessionId: string; roastSessionId: string }) => Promise<unknown>;

/** Form fields required to persist a completed roast (matches summary modal). */
export type SaveRoastFormData = {
    notes: string;
    /** Green input, in kg — prefilled from batch size, drives stock deduction. */
    weightGrams: number;
    /** Measured roasted output, in kg. 0/undefined = not weighed. */
    outputWeightKg?: number;
    roastLevel: string | null;
    beanId: string | null;
    /** resolved handoff for ad-hoc schedule link (from day batches) */
    linkedBatch?: PlanBatchHandoff | null;
};

export interface SaveRoastParams {
    formData: SaveRoastFormData;
    handoffBeanName: string | null;
    sessionId: string | null;
    userId: string;
    elapsed: number;
    roastStartTimeRef: React.MutableRefObject<number>;
    rawBT: number | null;
    ambientTemperature?: number | null;
    ambientHumidity?: number | null;
    selectedBeanId: string | null;
    targetProfileId: string | null;
    planBatchHandoff: PlanBatchHandoff | null;
    logEntries: LogEntry[];
}

export interface SaveRoastResult {
    savedSession: Awaited<ReturnType<ReturnType<typeof useCreateRoastSession>['mutateAsync']>>;
    deductionPlan: ReturnType<typeof determineStockDeduction>;
    shouldOpenContinue: boolean;
}

/** Handoff wins; otherwise ad-hoc linked batch from the save form. */
export const resolveEffectiveBatch = (
    planBatchHandoff: PlanBatchHandoff | null,
    linkedBatch?: PlanBatchHandoff | null,
): PlanBatchHandoff | null => planBatchHandoff ?? linkedBatch ?? null;

export const useSaveRoast = (planBatchHandoff: PlanBatchHandoff | null, syncRoastCurve: SyncRoastCurve) => {
    const user = useAuthStore((s) => s.user);
    const plan = useAuthStore((s) => s.plan);
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const userId = workspaceOwnerId;
    const qc = useQueryClient();

    const { mutateAsync: saveRoastSession, isPending: isSaving } = useCreateRoastSession(userId);
    // Single-batch update: invalidates schedule roots regardless of which planId (ad-hoc link safe)
    const { mutateAsync: updatePlanBatch } = useUpdateSingleBatch();
    const startBatch = useRoastSessionStore((s) => s.startBatch);

    const saveRoast = useCallback(
        async (params: SaveRoastParams): Promise<SaveRoastResult> => {
            if (!user) {
                throw new Error('Not authenticated');
            }
            if (!isWorkspaceReady || !userId) {
                throw new Error('Workspace is still loading');
            }

            const monthCap = planMaxBatchesPerMonth(plan);
            if (monthCap != null) {
                const used = await roastSessionApi.countCompletedThisMonth(userId);
                if (!canCompleteBatch(plan, used)) {
                    throw new BatchLimitError(used, monthCap);
                }
            }

            const { formData, handoffBeanName, sessionId, ...payloadParams } = params;
            const effectiveBatch = resolveEffectiveBatch(planBatchHandoff, formData.linkedBatch);

            const weightGrams = Math.round(formData.weightGrams * 1000);
            const outputKg = formData.outputWeightKg;
            const outputWeightGrams =
                outputKg != null && Number.isFinite(outputKg) && outputKg > 0 ? Math.round(outputKg * 1000) : null;
            // Linked / handoff batch supplies bean/blend; else form or header selection
            const resolvedBeanId = effectiveBatch?.beanId ?? formData.beanId ?? payloadParams.selectedBeanId;
            const blendId = effectiveBatch?.blendId ?? null;

            // Stock deduct / session bean link: require single bean or blend
            if (!resolvedBeanId && !blendId) {
                throw new Error('Select a green bean before saving.');
            }

            const roastedAt =
                payloadParams.roastStartTimeRef.current > 0
                    ? new Date(payloadParams.roastStartTimeRef.current).toISOString()
                    : null;

            // charge 시 확정된 BBP 요약 (없으면 null — 첫 배치/만료/무료 플랜).
            // 이 세션 것이 맞을 때만 사용 — 다른 배치 요약이 붙는 것을 막는다.
            const pendingBbp = useBbpStore.getState().finalized;
            const bbpSummary = pendingBbp?.sessionId === sessionId ? pendingBbp : null;

            const payload: RoastSessionInsert = {
                user_id: userId,
                weight_grams: weightGrams,
                output_weight_grams: outputWeightGrams,
                status: 'completed',
                roasted_at: roastedAt,
                duration_seconds: payloadParams.elapsed,
                drop_temp_celsius: payloadParams.rawBT != null ? Math.round(payloadParams.rawBT) : null,
                roast_level: formData.roastLevel,
                scheduled_at: null,
                notes: formData.notes || null,
                ambient_temp_celsius: payloadParams.ambientTemperature ?? null,
                ambient_humidity_pct: payloadParams.ambientHumidity ?? null,
                bean_id: resolvedBeanId,
                profile_id: payloadParams.targetProfileId,
                tsv_path: null,
                bbp_tsv_path: null,
                bbp_seconds: bbpSummary?.seconds ?? null,
                charge_temp_celsius: bbpSummary != null ? Math.round(bbpSummary.chargeTemp) : null,
                plan_batch_id: effectiveBatch?.planBatchId ?? null,
                events: serializeRoastEvents(payloadParams.logEntries),
            };

            const savedSession = await saveRoastSession(payload);

            // Meta returns immediately; curve sync background. Local TSV kept if sync fails.
            if (sessionId) {
                void syncRoastCurve({ sessionId, roastSessionId: savedSession.id }).catch((err) => {
                    logger.capture(err, { context: 'saveRoast tsv' });
                });
            }

            if (effectiveBatch) {
                const newCompletedCount = effectiveBatch.completedSessions + 1;
                // Keep store in sync for Continue modal (covers ad-hoc link too)
                startBatch({ ...effectiveBatch, completedSessions: newCompletedCount });

                if (newCompletedCount >= effectiveBatch.batchCount) {
                    // useUpdateSingleBatch invalidates plan + schedule roots (not tied to handoff planId)
                    updatePlanBatch({
                        id: effectiveBatch.planBatchId,
                        patch: { id: effectiveBatch.planBatchId, status: 'done' },
                    }).catch((err) => logger.capture(err, { context: 'saveRoast batch status' }));
                }
            }

            if (!effectiveBatch) {
                // 애드혹 연속 배치: 다음 저장 폼 프리필용으로 이번 값을 기록
                useRoastSessionStore.getState().recordAdhocSave({
                    beanId: resolvedBeanId,
                    weightKg: formData.weightGrams,
                    roastLevel: formData.roastLevel,
                });
            }

            const cachedBeans = userId ? qc.getQueryData<Bean[]>(beanKeys.all(userId)) : undefined;
            const resolvedBeanName =
                effectiveBatch?.beanName ??
                handoffBeanName ??
                (resolvedBeanId ? (cachedBeans?.find((b) => b.id === resolvedBeanId)?.name ?? null) : null);

            const deductionPlan = determineStockDeduction({
                planBatchHandoff: effectiveBatch,
                saveWeight: weightGrams,
                selectedBeanId: resolvedBeanId,
                referenceId: savedSession.id,
                handoffBeanName: resolvedBeanName,
            });

            return {
                savedSession,
                deductionPlan,
                shouldOpenContinue: effectiveBatch != null,
            };
        },
        [
            user,
            userId,
            isWorkspaceReady,
            plan,
            qc,
            syncRoastCurve,
            saveRoastSession,
            planBatchHandoff,
            startBatch,
            updatePlanBatch,
        ],
    );

    return useMemo(
        () => ({
            saveRoast,
            isSaving,
        }),
        [saveRoast, isSaving],
    );
};
