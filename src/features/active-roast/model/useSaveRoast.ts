import { beanKeys } from '@entities/bean/queries';
import { stockEventKeys } from '@entities/bean-stock-event';
import { copyMachineSnapshot, EMPTY_MACHINE_SNAPSHOT } from '@entities/machine';
import { useActiveWorkspace } from '@entities/organization';
import { invalidateScheduledBatchQueries, planBatchApi } from '@entities/plan';
import { invalidateRoastSessionQueries, type RoastSessionInsert, roastSessionApi } from '@entities/roast';
import { roastedStockKeys } from '@entities/roasted-stock-event';
import { determineStockDeduction } from '@features/active-roast/lib/determine-stock-deduction';
import { buildRoastedInbound } from '@features/active-roast/lib/roastedInbound';
import { serializeRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { i18n } from '@shared/i18n';
import { ensureSession } from '@shared/lib/ensureSession';
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
import { flushTsv } from '@shared/lib/tsv-writer';
import { useAuthStore } from '@shared/store/auth';
import type { Bean, PlanBatchHandoff, RoastSession } from '@shared/types/database.types';
import type { LogEntry } from '@shared/types/roast';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { resumePendingRoastSave } from '../lib/resumePendingRoastSave';
import type { PendingRoastSave } from './pendingRoastSave';
import type { SaveRoastFormData, SaveRoastParams, SaveRoastResult, SyncRoastCurve } from './save-roast-types';

export type { SaveRoastFormData, SaveRoastParams, SaveRoastResult, SyncRoastCurve };

/** Prefer Drop event temp, then End, then live BT (#173). */
export function resolveDropTempCelsius(logEntries: LogEntry[], rawBT: number | null | undefined): number | null {
    const drop =
        logEntries.find((e) => e.event === 'Drop' && e.tempC != null) ??
        logEntries.find((e) => e.event === 'End' && e.tempC != null);
    if (drop?.tempC != null) return Math.round(drop.tempC);
    if (rawBT != null) return Math.round(rawBT);
    return null;
}

export type SaveRoastDeps = {
    plan: Parameters<typeof planMaxBatchesPerMonth>[0];
    qc: QueryClient;
    countCompletedThisMonth: (userId: string) => Promise<number>;
    countCompletedTotal: (userId: string) => Promise<number>;
    saveOp: typeof roastSessionApi.saveOp;
    flushCurve: (sessionId: string) => Promise<void>;
};

/** Handoff wins; otherwise ad-hoc linked batch from the save form. */
export const resolveEffectiveBatch = (
    planBatchHandoff: PlanBatchHandoff | null,
    linkedBatch?: PlanBatchHandoff | null,
): PlanBatchHandoff | null => planBatchHandoff ?? linkedBatch ?? null;

/** Core save path — testable without React hooks. */
export async function saveRoastCore(deps: SaveRoastDeps, params: SaveRoastParams): Promise<SaveRoastResult> {
    const { plan, qc, countCompletedThisMonth, countCompletedTotal, saveOp, flushCurve } = deps;

    const { userId, sessionId } = params;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const linked = params.planBatchHandoff ?? params.formData.linkedBatch;
    const linkedId = linked?.planBatchId;
    if (!userId || !sessionId || !uuid.test(sessionId) || (linked != null && (!linkedId || !uuid.test(linkedId)))) {
        throw Object.assign(new Error('Unprepared roast save identity'), { code: '22P02' });
    }

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

    const { formData, handoffBeanName, planBatchHandoff: paramsHandoff, ...payloadParams } = params;
    const effectiveBatch = resolveEffectiveBatch(paramsHandoff, formData.linkedBatch);

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

    if (weightGrams > 0 && !resolvedBeanId && !blendId && !beanLabel) {
        throw new Error('Select a green bean before saving.');
    }

    const roastedAt = payloadParams.roastStartTime > 0 ? new Date(payloadParams.roastStartTime).toISOString() : null;

    // charge 시 확정된 BBP 요약 (없으면 null — 첫 배치/무료 플랜).
    // 이 세션 것이 맞을 때만 사용 — 다른 배치 요약이 붙는 것을 막는다.
    const pendingBbp = params.bbpSummary;
    const bbpSummary = pendingBbp?.sessionId === sessionId ? pendingBbp : null;

    const payload: RoastSessionInsert = {
        // Client session uuid as PK — save_roast_op converges retries on one row.
        // The pending coordinator durably allocates IDs even for unrecorded roasts.
        id: sessionId,
        user_id: userId,
        weight_grams: weightGrams,
        output_weight_grams: outputWeightGrams,
        status: 'completed',
        roasted_at: roastedAt,
        duration_seconds: payloadParams.elapsed,
        // Drop log = discharge temp; End = confirmEndRoast capture; live rawBT only as last resort (#173)
        drop_temp_celsius: resolveDropTempCelsius(payloadParams.logEntries, payloadParams.rawBT),
        roast_level: formData.roastLevel,
        scheduled_at: null,
        notes: formData.notes || null,
        ambient_temp_celsius: payloadParams.ambientTemperature ?? null,
        ambient_humidity_pct: payloadParams.ambientHumidity ?? null,
        bean_id: resolvedBeanId,
        bean_label: beanLabel,
        batch_name: formData.batchName?.trim() || null,
        profile_id: payloadParams.targetProfileId,
        tsv_path: null,
        bbp_tsv_path: null,
        bbp_seconds: bbpSummary?.seconds ?? null,
        charge_temp_celsius: bbpSummary != null ? Math.round(bbpSummary.chargeTemp) : null,
        plan_batch_id: effectiveBatch?.planBatchId ?? null,
        events: serializeRoastEvents(payloadParams.logEntries),
        ...copyMachineSnapshot(payloadParams.machineSnapshot ?? EMPTY_MACHINE_SNAPSHOT),
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

    if (sessionId) await flushCurve(sessionId);

    const savedSession = await saveOp({
        session: payload,
        deduct: wantDeduct,
        deductionGrams,
        inboundGrams: inbound?.grams ?? 0,
        inboundIsEstimate: inbound?.isEstimate ?? false,
        ...(effectiveBatch
            ? { expectedBatch: { beanId: effectiveBatch.beanId, blendId: effectiveBatch.blendId ?? null } }
            : {}),
    }).catch((e: unknown) => {
        throw mapServerBatchGateError(e) ?? e;
    });

    // History/dashboard refetch is awaited once in refreshCachesAfterRoastSave
    // (after optional schedule progress). Inventory marks are fire-and-forget.
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

    return { savedSession, shouldOpenContinue: effectiveBatch != null };
}

/** Single post-save cache refresh — covers lost RPC (saveRoastCore never ran invalidation). */
export async function refreshCachesAfterRoastSave(qc: QueryClient, saved: RoastSession): Promise<void> {
    try {
        if (saved.plan_batch_id) await planBatchApi.syncRoastProgress(saved.user_id, saved.plan_batch_id);
        invalidateScheduledBatchQueries(qc);
        await invalidateRoastSessionQueries(qc, saved.user_id);
    } catch (err) {
        // resumePendingRoastSave turns this into syncPending and does not rethrow.
        logger.capture(err, { context: 'refreshCachesAfterRoastSave', planBatchId: saved.plan_batch_id });
        throw err;
    }
    for (const queryKey of [
        inventoryQueryRoots.beanStockSummaries,
        inventoryQueryRoots.beanStockSummary,
        inventoryQueryRoots.beanStockEvents,
        roastedStockKeys.byUser(saved.user_id),
    ]) {
        void qc.invalidateQueries({ queryKey, refetchType: 'all' });
    }
}

export const useSaveRoast = (_handoff: PlanBatchHandoff | null, syncRoastCurve: SyncRoastCurve) => {
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const plan = useEffectivePlan(undefined, workspaceOwnerId);
    const qc = useQueryClient();
    const [isSaving, setIsSaving] = useState(false);
    const saveRoast = useCallback(
        async (params: SaveRoastParams) => {
            if (
                !isWorkspaceReady ||
                !workspaceOwnerId ||
                params.userId !== workspaceOwnerId ||
                !useAuthStore.getState().user
            ) {
                throw new Error(i18n.t('activeRoast.summary.workspaceLoading'));
            }
            return saveRoastCore(
                {
                    plan,
                    qc,
                    countCompletedThisMonth: roastSessionApi.countCompletedThisMonth,
                    countCompletedTotal: roastSessionApi.countCompletedTotal,
                    saveOp: roastSessionApi.saveOp,
                    flushCurve: flushTsv,
                },
                params,
            );
        },
        [isWorkspaceReady, workspaceOwnerId, plan, qc],
    );
    const resumeSave = useCallback(
        async (pending: PendingRoastSave) => {
            setIsSaving(true);
            try {
                return await resumePendingRoastSave({
                    pending,
                    ownerId: workspaceOwnerId,
                    saveRoast,
                    findSession: roastSessionApi.find,
                    ensureAccess: async () => {
                        if (
                            !isWorkspaceReady ||
                            !workspaceOwnerId ||
                            pending.params.userId !== workspaceOwnerId ||
                            !(await ensureSession())
                        ) {
                            throw new Error(i18n.t('activeRoast.summary.sessionExpired'));
                        }
                    },
                    resolveForRoast: planBatchApi.resolveForRoast,
                    syncBatch: (saved) => refreshCachesAfterRoastSave(qc, saved),
                    syncRoastCurve,
                });
            } finally {
                setIsSaving(false);
            }
        },
        [workspaceOwnerId, isWorkspaceReady, saveRoast, syncRoastCurve, qc],
    );
    return useMemo(() => ({ saveRoast, resumeSave, isSaving }), [saveRoast, resumeSave, isSaving]);
};
