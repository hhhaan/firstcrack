import {
    dayPlanApi,
    invalidatePlanScope,
    planBatchApi,
    planKeys,
    useCreatePlanBatch,
    useCreateRecurringBatches,
    useDeleteAllBatches,
    useDeleteFromThis,
    useDeleteSingleBatch,
    useReorderPlanBatches,
    useUpdateAllBatches,
    useUpdateFromThis,
    useUpdateSingleBatch,
} from '@entities/plan';
import { roastedStockKeys } from '@entities/roasted-stock-event';
import { inventoryQueryRoots } from '@shared/lib/query-keys';
import { buildRRule } from '@shared/lib/rrule';
import type { PlanBatchHandoff, PlanBatchInsert, PlanBatchWithProgress } from '@shared/types/database.types';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useCallback } from 'react';
import {
    type BatchTarget,
    buildReorderIds,
    type CompleteBatchFlowDeps,
    nextOneOffOrderIndex,
    runCompleteBatchFlow,
} from '../lib/plan-day-flow';
import type { EditScope, NewBatchData } from '../lib/types';

/**
 * Plan Day write paths — every mutation the day view can make, in one place.
 *
 * The view keeps modal state and user prompts (confirm/alert) and calls in here;
 * nothing here prompts, so each write is a plain promise the caller can wrap.
 * Batch completion deducts inside `complete_plan_batch`.
 */
export const usePlanDayWrites = ({
    userId,
    dateKey,
    planId,
    batches,
}: {
    userId: string;
    /** yyyy-MM-dd of the day being viewed */
    dateKey: string;
    /** '' until the day plan row exists — creates lazily on first write */
    planId: string;
    /** Batches shown for dateKey — reorder/new index inputs */
    batches: PlanBatchWithProgress[];
}) => {
    const qc = useQueryClient();
    const createBatch = useCreatePlanBatch(planId, userId, dateKey);
    const reorderBatches = useReorderPlanBatches({ userId, date: dateKey, planId });
    const createRecurringBatches = useCreateRecurringBatches(userId, planId);
    const deleteSingleBatch = useDeleteSingleBatch({ userId, date: dateKey });
    const deleteFromThis = useDeleteFromThis();
    const deleteAllBatches = useDeleteAllBatches();
    const updateSingleBatch = useUpdateSingleBatch();
    const updateFromThis = useUpdateFromThis();
    const updateAllBatches = useUpdateAllBatches();

    const ensureMaterialized = useCallback(
        async (batch: PlanBatchWithProgress): Promise<BatchTarget> => {
            const latest = await planBatchApi.resolveForRoast(userId, batch);
            return { targetId: latest.id, targetPlanId: latest.plan_id, batch: latest };
        },
        [userId],
    );

    const startBatch = useCallback(
        async (batch: PlanBatchWithProgress): Promise<PlanBatchHandoff> => {
            const latest = await planBatchApi.startForRoast(userId, batch);
            invalidatePlanScope(qc, userId);
            return {
                planBatchId: latest.id,
                planId: latest.plan_id,
                beanId: latest.bean_id,
                blendId: latest.blend_id ?? null,
                beanName: latest.bean_name,
                batchSizeKg: Number(latest.batch_size_kg),
                profileId: latest.roast_profile_id,
                batchCount: latest.batch_count,
                completedSessions: latest.completed_sessions,
            };
        },
        [userId, qc],
    );

    const completeBatch = useCallback(
        (batch: PlanBatchWithProgress, deductStock: boolean, deps: Pick<CompleteBatchFlowDeps, 'notify'>) =>
            runCompleteBatchFlow(
                {
                    ensureMaterialized,
                    notify: deps.notify,
                    complete: async (batchId, deduct) => {
                        await planBatchApi.complete(batchId, deduct);
                        invalidatePlanScope(qc, userId);
                        void qc.invalidateQueries({ queryKey: inventoryQueryRoots.beanStockSummaries });
                        void qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(userId) });
                    },
                },
                batch,
                deductStock,
            ),
        [ensureMaterialized, qc, userId],
    );

    const createOneOffOrRecurring = useCallback(
        async (data: NewBatchData) => {
            const baseBatch: Omit<PlanBatchInsert, 'plan_id'> = {
                order_index: nextOneOffOrderIndex(batches),
                bean_name: data.beanName || data.batchType,
                bean_id: data.beanId,
                blend_id: data.blendId ?? null,
                batch_type: data.batchType,
                roast_profile_id: data.profileId,
                machine_id: data.machineId || null,
                target_roasted_kg: data.targetRoasted,
                batch_size_kg: data.batchSize,
                yield_pct: data.yieldPct / 100,
                notes: data.notes,
                green_lot: data.greenLot,
                status: 'pending',
            };

            if (data.recurringInterval) {
                await createRecurringBatches.mutateAsync({
                    baseBatch,
                    interval: data.recurringInterval,
                    dtstart: data.date,
                });
            } else if (planId) {
                await createBatch.mutateAsync({ ...baseBatch, plan_id: planId });
            } else {
                const plan = await dayPlanApi.getOrCreate(userId, dateKey);
                await createBatch.mutateAsync({ ...baseBatch, plan_id: plan.id });
            }
        },
        [planId, batches, createBatch, createRecurringBatches, userId, dateKey],
    );

    /** One-off edit; a date change moves the row to that day's plan and refreshes both days. */
    const editBatch = useCallback(
        async (editing: PlanBatchWithProgress, data: NewBatchData) => {
            const newDateKey = format(data.date, 'yyyy-MM-dd');
            const dateChanged = newDateKey !== dateKey;
            const isBlendType = data.batchType === 'Pre-roast Blend' || data.batchType === 'Post-roast Blend';
            let targetPlanId = editing.plan_id;
            const oldPlanId = editing.plan_id;

            if (dateChanged) {
                const newPlan = await dayPlanApi.getOrCreate(userId, newDateKey);
                targetPlanId = newPlan.id;
                await planBatchApi.move(editing.id, targetPlanId);
            }

            await updateSingleBatch.mutateAsync({
                id: editing.id,
                patch: {
                    id: editing.id,
                    plan_id: targetPlanId,
                    machine_id: data.machineId || null,
                    batch_type: data.batchType,
                    roast_profile_id: data.profileId,
                    bean_id: isBlendType ? null : data.beanId,
                    blend_id: isBlendType ? data.blendId : null,
                    bean_name: data.beanName || editing.bean_name,
                    target_roasted_kg: data.targetRoasted,
                    batch_size_kg: data.batchSize,
                    yield_pct: data.yieldPct / 100,
                    green_lot: data.greenLot,
                    notes: data.notes,
                },
            });

            if (dateChanged) {
                void qc.invalidateQueries({ queryKey: planKeys.batches(oldPlanId) });
                void qc.invalidateQueries({ queryKey: planKeys.batches(targetPlanId) });
                void qc.invalidateQueries({ queryKey: planKeys.dayBatches(userId, dateKey) });
                void qc.invalidateQueries({ queryKey: planKeys.dayBatches(userId, newDateKey) });
            }
        },
        [dateKey, userId, updateSingleBatch, qc],
    );

    /** Recurring edit by scope: single instance (exception row), from this date, or the whole rule. */
    const editRecurring = useCallback(
        async (editing: PlanBatchWithProgress, scope: EditScope, data: NewBatchData) => {
            if (!editing.recurrence_rule_id) return;

            const basePatch = {
                id: editing.id,
                plan_id: '',
                bean_name: data.beanName || editing.bean_name,
                bean_id: data.beanId,
                blend_id: data.blendId ?? null,
                batch_type: data.batchType,
                roast_profile_id: data.profileId,
                machine_id: data.machineId,
                target_roasted_kg: data.targetRoasted,
                batch_size_kg: data.batchSize,
                yield_pct: data.yieldPct / 100,
                notes: data.notes,
                green_lot: data.greenLot,
            };

            if (scope === 'single') {
                let targetPlanId = editing.plan_id;
                if (!targetPlanId) {
                    const plan = await dayPlanApi.getOrCreate(userId, editing.scheduled_date ?? dateKey);
                    targetPlanId = plan.id;
                }
                const isVirtual = editing.id.includes(':');
                await updateSingleBatch.mutateAsync({
                    id: editing.id,
                    patch: { ...basePatch, plan_id: targetPlanId ?? '' },
                    // Virtual only: materialize via exception insert. Real exception → UPDATE.
                    ...(isVirtual
                        ? {
                              meta: {
                                  recurrenceRuleId: editing.recurrence_rule_id,
                                  originalDate: editing.original_date ?? editing.scheduled_date ?? dateKey,
                              },
                          }
                        : {}),
                });
                return;
            }

            const instanceDate = editing.scheduled_date ?? dateKey;
            const masterPatch = {
                machine_id: data.machineId || null,
                roast_profile_id: data.profileId,
                bean_id: data.beanId,
                blend_id: data.blendId ?? null,
                bean_name: data.beanName || editing.bean_name,
                green_lot: data.greenLot,
                batch_size_kg: data.batchSize,
                yield_pct: data.yieldPct / 100,
                target_roasted_kg: data.targetRoasted,
                notes: data.notes,
                batch_type: data.batchType,
                ...(data.recurringInterval ? { rrule: buildRRule(data.recurringInterval) } : {}),
            };

            if (scope === 'from_this') {
                await updateFromThis.mutateAsync({
                    ruleId: editing.recurrence_rule_id,
                    fromDate: instanceDate,
                    patch: { ...masterPatch, dtstart: instanceDate, userId },
                });
            } else {
                await updateAllBatches.mutateAsync({ ruleId: editing.recurrence_rule_id, patch: masterPatch });
            }
        },
        [updateSingleBatch, updateFromThis, updateAllBatches, dateKey, userId],
    );

    /** One-off delete. Caller confirms first. */
    const deleteBatch = useCallback(
        (batch: PlanBatchWithProgress) => deleteSingleBatch.mutateAsync({ id: batch.id }),
        [deleteSingleBatch],
    );

    /** Recurring delete by scope. Caller confirms first. */
    const deleteRecurring = useCallback(
        async (batch: PlanBatchWithProgress, scope: EditScope) => {
            if (!batch.recurrence_rule_id) return;
            if (scope === 'single') {
                let targetPlanId = batch.plan_id;
                if (!targetPlanId && batch.scheduled_date) {
                    const plan = await dayPlanApi.getOrCreate(userId, batch.scheduled_date);
                    targetPlanId = plan.id;
                }
                await deleteSingleBatch.mutateAsync({
                    id: batch.id,
                    meta: {
                        recurrenceRuleId: batch.recurrence_rule_id,
                        originalDate: batch.scheduled_date ?? dateKey,
                        planId: targetPlanId ?? '',
                    },
                });
            } else if (scope === 'from_this') {
                await deleteFromThis.mutateAsync({ ruleId: batch.recurrence_rule_id, fromDate: dateKey });
            } else {
                await deleteAllBatches.mutateAsync(batch.recurrence_rule_id);
            }
        },
        [deleteSingleBatch, deleteFromThis, deleteAllBatches, dateKey, userId],
    );

    const moveBatch = useCallback(
        (index: number, dir: 'up' | 'down') => {
            const orderedIds = buildReorderIds(batches, index, dir);
            if (orderedIds) reorderBatches.mutate(orderedIds);
        },
        [batches, reorderBatches],
    );

    return {
        startBatch,
        completeBatch,
        createBatch: createOneOffOrRecurring,
        editBatch,
        editRecurring,
        deleteBatch,
        deleteRecurring,
        moveBatch,
    };
};
