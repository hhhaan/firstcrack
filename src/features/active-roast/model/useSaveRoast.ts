import { beanKeys } from '@entities/bean/queries';
import { stockEventKeys } from '@entities/bean-stock-event';
import { useActiveWorkspace } from '@entities/organization';
import { useUpdateSingleBatch } from '@entities/plan';
import { invalidateAfterCreateRoastSession, type RoastSessionInsert, roastSessionApi } from '@entities/roast';
import { roastedStockKeys } from '@entities/roasted-stock-event';
import { determineStockDeduction } from '@features/active-roast/lib/determine-stock-deduction';
import { buildRoastedInbound } from '@features/active-roast/lib/roastedInbound';
import { serializeRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { useBbpStore } from '@features/active-roast/model/bbp';
import {
    BatchLimitError,
    canCompleteBatch,
    isWritablePlan,
    mapServerBatchGateError,
    planMaxBatchesPerMonth,
    TRIAL_BATCH_CAP,
    useEffectivePlan,
} from '@shared/lib/features';
import { logger } from '@shared/lib/logger';
import { inventoryQueryRoots } from '@shared/lib/query-keys';
import { useAuthStore } from '@shared/store/auth';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { Bean, PlanBatchHandoff, RoastSession } from '@shared/types/database.types';
import type { LogEntry } from '@shared/types/roast';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

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
    /**
     * Free-text bean name for sample / no-inventory roasts.
     * Stored on session.bean_label; never creates beans rows or stock events.
     */
    beanLabel?: string | null;
    /** resolved handoff for ad-hoc schedule link (from day batches) */
    linkedBatch?: PlanBatchHandoff | null;
    /** When true, server deducts green in the same TX as session save (C1). */
    deductStock?: boolean;
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
    savedSession: RoastSession;
    deductionPlan: ReturnType<typeof determineStockDeduction>;
    shouldOpenContinue: boolean;
    /** Session saved but plan_batch status=done update failed — user should complete it in Schedule. */
    batchStatusUpdateFailed?: boolean;
}

export type SaveRoastDeps = {
    plan: Parameters<typeof planMaxBatchesPerMonth>[0];
    userId: string;
    qc: QueryClient;
    planBatchHandoff: PlanBatchHandoff | null;
    countCompletedThisMonth: (userId: string) => Promise<number>;
    countCompletedTotal: (userId: string) => Promise<number>;
    saveOp: typeof roastSessionApi.saveOp;
    syncRoastCurve: SyncRoastCurve;
    updatePlanBatch: ReturnType<typeof useUpdateSingleBatch>['mutateAsync'];
    startBatch: (b: PlanBatchHandoff) => void;
    recordAdhocSave: (p: { beanId: string | null; weightKg: number; roastLevel: string | null }) => void;
    getFinalizedBbp: () => ReturnType<typeof useBbpStore.getState>['finalized'];
};

/** Handoff wins; otherwise ad-hoc linked batch from the save form. */
export const resolveEffectiveBatch = (
    planBatchHandoff: PlanBatchHandoff | null,
    linkedBatch?: PlanBatchHandoff | null,
): PlanBatchHandoff | null => planBatchHandoff ?? linkedBatch ?? null;

/** Core save path — testable without React hooks. */
export async function saveRoastCore(deps: SaveRoastDeps, params: SaveRoastParams): Promise<SaveRoastResult> {
    const {
        plan,
        userId,
        qc,
        planBatchHandoff,
        countCompletedThisMonth,
        countCompletedTotal,
        saveOp,
        syncRoastCurve,
        updatePlanBatch,
        startBatch,
        recordAdhocSave,
        getFinalizedBbp,
    } = deps;

    // UX pre-checks only — the DB trigger (enforce_batch_gate) is the authority.
    // Count failures (network etc.) fail open: skip the pre-check and let the
    // server trigger decide. Only a successful count that exceeds the cap blocks.
    if (!isWritablePlan(plan)) {
        throw new BatchLimitError(0, 0, 'read_only_plan');
    }
    if (plan === 'trial') {
        try {
            const used = await countCompletedTotal(userId);
            if (used >= TRIAL_BATCH_CAP) {
                throw new BatchLimitError(used, TRIAL_BATCH_CAP, 'trial_batch_cap');
            }
        } catch (err) {
            if (err instanceof BatchLimitError) throw err;
            logger.capture(err, { context: 'saveRoast trial count pre-check' });
        }
    } else {
        const monthCap = planMaxBatchesPerMonth(plan);
        if (monthCap != null) {
            try {
                const used = await countCompletedThisMonth(userId);
                if (!canCompleteBatch(plan, used)) {
                    throw new BatchLimitError(used, monthCap);
                }
            } catch (err) {
                if (err instanceof BatchLimitError) throw err;
                logger.capture(err, { context: 'saveRoast monthly count pre-check' });
            }
        }
    }

    const { formData, handoffBeanName, sessionId, ...payloadParams } = params;
    const effectiveBatch = resolveEffectiveBatch(planBatchHandoff, formData.linkedBatch);

    const weightGrams = Math.round(formData.weightGrams * 1000);
    const outputKg = formData.outputWeightKg;
    const outputWeightGrams =
        outputKg != null && Number.isFinite(outputKg) && outputKg > 0 ? Math.round(outputKg * 1000) : null;
    // Linked / handoff batch supplies bean/blend; else form selection.
    // Free-text label (form beanLabel) wins over header selectedBeanId — typing a
    // custom name must not be overwritten by a pre-charge inventory pick.
    const blendId = effectiveBatch?.blendId ?? null;
    const beanLabelRaw = formData.beanLabel?.trim() || null;
    const inventoryBeanId =
        effectiveBatch?.beanId ?? formData.beanId ?? (beanLabelRaw ? null : payloadParams.selectedBeanId);
    const resolvedBeanId = inventoryBeanId ?? null;
    const beanLabel = resolvedBeanId || blendId ? null : beanLabelRaw;

    // Weight set → need inventory bean/blend or a free-text label (history display).
    if (weightGrams > 0 && !resolvedBeanId && !blendId && !beanLabel) {
        throw new Error('Select a green bean before saving.');
    }

    const roastedAt =
        payloadParams.roastStartTimeRef.current > 0
            ? new Date(payloadParams.roastStartTimeRef.current).toISOString()
            : null;

    // charge 시 확정된 BBP 요약 (없으면 null — 첫 배치/만료/무료 플랜).
    // 이 세션 것이 맞을 때만 사용 — 다른 배치 요약이 붙는 것을 막는다.
    const pendingBbp = getFinalizedBbp();
    const bbpSummary = pendingBbp?.sessionId === sessionId ? pendingBbp : null;

    const payload: RoastSessionInsert = {
        // Client session uuid as PK — save_roast_op converges retries on one row.
        // Null sessionId (never charged) falls back to server-generated id.
        id: sessionId ?? undefined,
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
        bean_label: beanLabel,
        profile_id: payloadParams.targetProfileId,
        tsv_path: null,
        bbp_tsv_path: null,
        bbp_seconds: bbpSummary?.seconds ?? null,
        charge_temp_celsius: bbpSummary != null ? Math.round(bbpSummary.chargeTemp) : null,
        plan_batch_id: effectiveBatch?.planBatchId ?? null,
        events: serializeRoastEvents(payloadParams.logEntries),
    };

    // Free-text label sessions never touch inventory (green deduct or roasted inbound).
    const canTouchStock = Boolean(resolvedBeanId || blendId);
    const inbound = canTouchStock
        ? buildRoastedInbound({
              greenGrams: weightGrams,
              outputWeightGrams,
              roastLevel: formData.roastLevel,
          })
        : null;

    const cachedBeans = userId ? qc.getQueryData<Bean[]>(beanKeys.all(userId)) : undefined;
    const resolvedBeanName =
        effectiveBatch?.beanName ??
        handoffBeanName ??
        beanLabel ??
        (resolvedBeanId ? (cachedBeans?.find((b) => b.id === resolvedBeanId)?.name ?? null) : null);

    // provisional plan for grams/canDeduct — reference filled after save
    const provisionalPlan = canTouchStock
        ? determineStockDeduction({
              planBatchHandoff: effectiveBatch,
              saveWeight: weightGrams,
              selectedBeanId: resolvedBeanId,
              referenceId: 'pending',
              handoffBeanName: resolvedBeanName,
          })
        : null;

    const wantDeduct = Boolean(formData.deductStock && provisionalPlan?.canDeduct);
    const deductionGrams = wantDeduct ? (provisionalPlan?.deductionGrams ?? 0) : 0;

    const savedSession = await saveOp({
        session: payload,
        deduct: wantDeduct,
        deductionGrams,
        inboundGrams: inbound?.grams ?? 0,
        inboundIsEstimate: inbound?.isEstimate ?? false,
    }).catch((e: unknown) => {
        throw mapServerBatchGateError(e) ?? e;
    });

    // Await so inactive History/dashboard caches refetch before the user switches tabs.
    await invalidateAfterCreateRoastSession(qc, userId);
    if (wantDeduct && provisionalPlan) {
        void qc.invalidateQueries({ queryKey: inventoryQueryRoots.beanStockSummaries, refetchType: 'all' });
        if (provisionalPlan.singleBeanId) {
            void qc.invalidateQueries({
                queryKey: stockEventKeys.summary(provisionalPlan.singleBeanId),
                refetchType: 'all',
            });
            void qc.invalidateQueries({
                queryKey: stockEventKeys.byBean(provisionalPlan.singleBeanId),
                refetchType: 'all',
            });
        }
    }
    if (inbound) {
        void qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(userId), refetchType: 'all' });
    }

    // Meta returns immediately; curve sync background. Local TSV kept if sync fails.
    if (sessionId) {
        void syncRoastCurve({ sessionId, roastSessionId: savedSession.id }).catch((err) => {
            logger.capture(err, { context: 'saveRoast tsv' });
        });
    }

    let batchStatusUpdateFailed = false;
    if (effectiveBatch) {
        const newCompletedCount = effectiveBatch.completedSessions + 1;
        // Keep store in sync for Continue modal (covers ad-hoc link too)
        startBatch({ ...effectiveBatch, completedSessions: newCompletedCount });

        if (newCompletedCount >= effectiveBatch.batchCount) {
            // useUpdateSingleBatch invalidates plan + schedule roots (not tied to handoff planId)
            try {
                await updatePlanBatch({
                    id: effectiveBatch.planBatchId,
                    patch: { id: effectiveBatch.planBatchId, status: 'done' },
                });
            } catch (err) {
                // Session save stays successful — surface for a toast; user reconciles
                // via the Schedule complete flow (deduct is idempotent there).
                logger.capture(err, { context: 'saveRoast batch status' });
                batchStatusUpdateFailed = true;
            }
        }
    } else {
        // 애드혹 연속 배치: 다음 저장 폼 프리필용으로 이번 값을 기록
        recordAdhocSave({
            beanId: resolvedBeanId,
            weightKg: formData.weightGrams,
            roastLevel: formData.roastLevel,
        });
    }

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
        batchStatusUpdateFailed,
    };
}

export const useSaveRoast = (planBatchHandoff: PlanBatchHandoff | null, syncRoastCurve: SyncRoastCurve) => {
    const user = useAuthStore((s) => s.user);
    // Counts below are owner-scoped, and so is the server's plan lookup — pairing them
    // with the personal plan would block an org member on the host's workspace.
    const plan = useEffectivePlan();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const userId = workspaceOwnerId;
    const qc = useQueryClient();
    const [isSaving, setIsSaving] = useState(false);

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

            setIsSaving(true);
            try {
                return await saveRoastCore(
                    {
                        plan,
                        userId,
                        qc,
                        planBatchHandoff,
                        countCompletedThisMonth: roastSessionApi.countCompletedThisMonth,
                        countCompletedTotal: roastSessionApi.countCompletedTotal,
                        saveOp: roastSessionApi.saveOp,
                        syncRoastCurve,
                        updatePlanBatch,
                        startBatch,
                        recordAdhocSave: (p) => useRoastSessionStore.getState().recordAdhocSave(p),
                        getFinalizedBbp: () => useBbpStore.getState().finalized,
                    },
                    params,
                );
            } finally {
                setIsSaving(false);
            }
        },
        [user, userId, isWorkspaceReady, plan, qc, syncRoastCurve, planBatchHandoff, startBatch, updatePlanBatch],
    );

    return useMemo(
        () => ({
            saveRoast,
            isSaving,
        }),
        [saveRoast, isSaving],
    );
};
