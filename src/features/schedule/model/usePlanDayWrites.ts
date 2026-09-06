import {
    dayPlanApi,
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
    recurringOriginalDate,
    runCompleteBatchFlow,
} from '../lib/plan-day-flow';
import type { EditScope, NewBatchData } from '../lib/types';

/**
 * Plan Day write paths — every mutation the day view can make, in one place.
 *
 * The view keeps modal state and user prompts (confirm/alert) and calls in here;
 * nothing here prompts, so each write is a plain promise the caller can wrap.
 * Green deduction on complete is injected (`deduct`) because it lives in
 * `features/active-roast` and features must not import features.
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

    // Virtual recurring instance → materialize as exception row with its CURRENT
    // status (no transition here — commitStatus does that after side-effects succeed).
    const ensureMaterialized = useCallback(
        async (batch: PlanBatchWithProgress): Promise<BatchTarget> => {
            if (batch.recurrence_rule_id && batch.id.includes(':') && batch.scheduled_date) {
                const realBatch = await planBatchApi.materialize(
                    userId,
                    batch.recurrence_rule_id,
                    batch.scheduled_date,
                    batch.original_date ?? batch.scheduled_date,
                    {
                        bean_name: batch.bean_name,
                        batch_size_kg: Number(batch.batch_size_kg),
                        target_roasted_kg: Number(batch.target_roasted_kg),
                        machine_id: batch.machine_id,
                        bean_id: batch.bean_id,
                        blend_id: batch.blend_id ?? null,
                        roast_profile_id: batch.roast_profile_id,
                        notes: batch.notes,
                        green_lot: batch.green_lot,
                        batch_type: batch.batch_type,
                        yield_pct: batch.yield_pct,
                        status: batch.status ?? 'pending',
                    },
                );
                return { targetId: realBatch.id, targetPlanId: realBatch.plan_id };
            }
            return { targetId: batch.id, targetPlanId: batch.plan_id };
        },
        [userId],
    );

    // Status UPDATE only — target must already be a real row (ensureMaterialized).
    // Never pass meta here: updateSingle(meta) inserts a new exception and
    // fails/duplicates when the row already exists.
    const commitStatus = useCallback(
        async (batch: PlanBatchWithProgress, target: BatchTarget, status: 'in-progress' | 'done') => {
            await updateSingleBatch.mutateAsync({
                id: target.targetId,
                patch: {
                    id: target.targetId,
                    plan_id: target.targetPlanId,
                    status,
                    ...(batch.recurrence_rule_id
                        ? {
                              bean_id: batch.bean_id,
                              blend_id: batch.blend_id ?? null,
                              bean_name: batch.bean_name,
                              roast_profile_id: batch.roast_profile_id,
                              batch_size_kg: batch.batch_size_kg,
                              target_roasted_kg: batch.target_roasted_kg,
                              yield_pct: batch.yield_pct,
                              notes: batch.notes,
                              green_lot: batch.green_lot,
                              batch_type: batch.batch_type,
                          }
                        : {}),
                },
            });
        },
        [updateSingleBatch],
    );

    /** Materialize + in-progress, then hand the real ids to Active Roast. */
    const startBatch = useCallback(
        async (batch: PlanBatchWithProgress): Promise<PlanBatchHandoff> => {
            const target = await ensureMaterialized(batch);
            await commitStatus(batch, target, 'in-progress');
            return {
                planBatchId: target.targetId,
                planId: target.targetPlanId,
                beanId: batch.bean_id,
                blendId: batch.blend_id ?? null,
                beanName: batch.bean_name,
                batchSizeKg: Number(batch.batch_size_kg),
                profileId: batch.roast_profile_id,
                batchCount: batch.batch_count,
                completedSessions: batch.completed_sessions,
            };
        },
        [ensureMaterialized, commitStatus],
    );

    const completeBatch = useCallback(
        (batch: PlanBatchWithProgress, deductStock: boolean, deps: Pick<CompleteBatchFlowDeps, 'deduct' | 'notify'>) =>
            runCompleteBatchFlow({ ensureMaterialized, commitStatus, ...deps }, batch, deductStock),
        [ensureMaterialized, commitStatus],
    );

    const createOneOffOrRecurring = useCallback(
        async (data: NewBatchData) => {
            const baseBatch: Omit<PlanBatchInsert, 'plan_id'> = {
                order_index: nextOneOffOrderIndex(batches),
                bean_name: data.beanName || data.batchType,
                bean_id: data.beanId,
                blend_id: data.blendId ?? null,
                batch_type: data.batchType,
                roast_profile_id: data.profileId || null,
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
                    roast_profile_id: data.profileId || null,
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
                roast_profile_id: data.profileId || null,
                machine_id: data.machineId,
                target_roasted_kg: data.targetRoasted,
                batch_size_kg: data.batchSize,
                yield_pct: data.yieldPct / 100,
                notes: data.notes,
                green_lot: data.greenLot,
            };

            if (scope === 'single') {
                const scheduleDate = format(data.date, 'yyyy-MM-dd');
                const plan = await dayPlanApi.getOrCreate(userId, scheduleDate);
                const isVirtual = editing.id.includes(':');
                await updateSingleBatch.mutateAsync({
                    id: editing.id,
                    patch: { ...basePatch, plan_id: plan.id, scheduled_date: scheduleDate },
                    // Virtual only: materialize via exception insert. Real exception → UPDATE.
                    ...(isVirtual
                        ? {
                              meta: {
                                  recurrenceRuleId: editing.recurrence_rule_id,
                                  originalDate: recurringOriginalDate(editing, dateKey),
                              },
                          }
                        : {}),
                });
                const oldDate = editing.scheduled_date ?? dateKey;
                if (scheduleDate !== oldDate || scheduleDate !== dateKey) {
                    void qc.invalidateQueries({ queryKey: planKeys.dayBatches(userId, dateKey) });
                    void qc.invalidateQueries({ queryKey: planKeys.dayBatches(userId, scheduleDate) });
                    if (oldDate !== dateKey && oldDate !== scheduleDate) {
                        void qc.invalidateQueries({ queryKey: planKeys.dayBatches(userId, oldDate) });
                    }
                }
                return;
            }

            const instanceDate = editing.scheduled_date ?? dateKey;
            const masterPatch = {
                machine_id: data.machineId || null,
                roast_profile_id: data.profileId || null,
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
        [updateSingleBatch, updateFromThis, updateAllBatches, dateKey, userId, qc],
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
                        originalDate: recurringOriginalDate(batch, dateKey),
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
