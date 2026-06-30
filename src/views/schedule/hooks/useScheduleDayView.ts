import { useBeanStockSummaries } from '@entities/bean-stock-event';
import {
    dayPlanApi,
    planBatchApi,
    planKeys,
    useCreatePlanBatch,
    useCreateRecurringBatches,
    useDayBatches,
    useDayPlan,
    useDeleteAllBatches,
    useDeleteFromThis,
    useDeleteSingleBatch,
    useReorderPlanBatches,
    useUpdateAllBatches,
    useUpdateFromThis,
    useUpdateSingleBatch,
} from '@entities/plan';
import { useDeductRoastStock } from '@features/active-roast';
import { getDateFnsLocale, i18n } from '@shared/i18n';
import { batchGreenNeededGramsFromBatch, isBatchStockShort } from '@shared/lib/batch-stock';
import { buildRRule } from '@shared/lib/rrule';
import type { PlanBatchHandoff, PlanBatchInsert, PlanBatchWithProgress } from '@shared/types/database.types';
import { useQueryClient } from '@tanstack/react-query';
import type { NewBatchData } from '@widgets/add-batch-modal';
import type { EditScope } from '@widgets/recurring-edit-scope-modal';
import { format } from 'date-fns';
import { useCallback, useMemo, useState } from 'react';
import { batchStatus, toDateKey } from '../lib';

// ── Shared helpers ─────────────────────────────────────────────────────────────

export const useScheduleDayView = ({
    userId,
    selectedDate,
    onStartBatch,
}: {
    userId: string;
    selectedDate: Date;
    onStartBatch: (handoff: PlanBatchHandoff) => void;
}) => {
    const dateKey = toDateKey(selectedDate);
    const qc = useQueryClient();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingBatch, setEditingBatch] = useState<PlanBatchWithProgress | null>(null);
    const [editScope, setEditScope] = useState<EditScope | null>(null);
    const [scopeBatch, setScopeBatch] = useState<PlanBatchWithProgress | null>(null);
    const [isEditScopeModalOpen, setIsEditScopeModalOpen] = useState(false);
    const [isDeleteScopeModalOpen, setIsDeleteScopeModalOpen] = useState(false);
    const [completingBatch, setCompletingBatch] = useState<PlanBatchWithProgress | null>(null);
    const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);

    const deductRoastStock = useDeductRoastStock();

    const { data: dayPlan, isLoading: isDayPlanLoading } = useDayPlan(userId, dateKey);
    const planId = dayPlan?.id ?? '';

    const { data: rangeData = [], isLoading: isBatchesLoading } = useDayBatches(userId, dateKey, 14);
    const batches = useMemo(() => rangeData.filter((b) => b.scheduled_date === dateKey), [rangeData, dateKey]);
    const overdueBatches = useMemo(
        () =>
            rangeData.filter(
                (b) =>
                    b.scheduled_date &&
                    b.scheduled_date < dateKey &&
                    batchStatus(b) !== 'done' &&
                    batchStatus(b) !== 'skipped',
            ),
        [rangeData, dateKey],
    );
    const { data: stockSummaries = {} } = useBeanStockSummaries(userId);
    const isLoading = isDayPlanLoading || isBatchesLoading;

    const createBatch = useCreatePlanBatch(planId, userId, dateKey);
    const reorderBatches = useReorderPlanBatches({ userId, date: dateKey, planId });
    const createRecurringBatches = useCreateRecurringBatches(userId, planId);
    const deleteSingleBatch = useDeleteSingleBatch({ userId, date: dateKey });
    const deleteFromThis = useDeleteFromThis();
    const deleteAllBatches = useDeleteAllBatches();
    const updateSingleBatch = useUpdateSingleBatch();
    const updateFromThis = useUpdateFromThis();
    const updateAllBatches = useUpdateAllBatches();

    const commitStatusTransition = useCallback(
        async (batch: PlanBatchWithProgress, status: 'in-progress' | 'done') => {
            const patch = {
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
                status,
            };

            if (batch.recurrence_rule_id && batch.id.includes(':') && batch.scheduled_date) {
                const realBatch = await planBatchApi.materialize(
                    userId,
                    batch.recurrence_rule_id,
                    batch.scheduled_date,
                    batch.original_date ?? batch.scheduled_date,
                    patch,
                );
                return { targetId: realBatch.id, targetPlanId: realBatch.plan_id };
            }

            await updateSingleBatch.mutateAsync({
                id: batch.id,
                patch: {
                    id: batch.id,
                    plan_id: batch.plan_id,
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
                ...(batch.recurrence_rule_id && batch.original_date
                    ? { meta: { recurrenceRuleId: batch.recurrence_rule_id, originalDate: batch.original_date } }
                    : {}),
            });

            return { targetId: batch.id, targetPlanId: batch.plan_id };
        },
        [updateSingleBatch, userId],
    );

    const handleScopeDelete = useCallback(
        async (scope: EditScope, batch: PlanBatchWithProgress) => {
            if (!batch.recurrence_rule_id) return;

            if (scope === 'single') {
                if (window.confirm(i18n.t('schedule.deleteConfirm.single'))) {
                    let targetPlanId = batch.plan_id;
                    if (!targetPlanId && batch.recurrence_rule_id && batch.scheduled_date) {
                        const plan = await dayPlanApi.getOrCreate(userId, batch.scheduled_date);
                        targetPlanId = plan.id;
                    }
                    deleteSingleBatch.mutate({
                        id: batch.id,
                        meta: {
                            recurrenceRuleId: batch.recurrence_rule_id,
                            originalDate: batch.scheduled_date ?? dateKey,
                            planId: targetPlanId ?? '',
                        },
                    });
                }
            } else if (scope === 'from_this') {
                if (
                    window.confirm(
                        i18n.t('schedule.deleteConfirm.fromThis', {
                            date: format(selectedDate, 'M월 d일', { locale: getDateFnsLocale() }),
                        }),
                    )
                ) {
                    deleteFromThis.mutate({
                        ruleId: batch.recurrence_rule_id,
                        fromDate: dateKey,
                    });
                }
            } else if (scope === 'all') {
                if (window.confirm(i18n.t('schedule.deleteConfirm.all'))) {
                    deleteAllBatches.mutate(batch.recurrence_rule_id);
                }
            }

            setIsDeleteScopeModalOpen(false);
            setScopeBatch(null);
        },
        [deleteSingleBatch, deleteFromThis, deleteAllBatches, dateKey, selectedDate, userId],
    );

    const handleEdit = useCallback((batch: PlanBatchWithProgress) => {
        if (batch.recurrence_rule_id) {
            setScopeBatch(batch);
            setIsEditScopeModalOpen(true);
        } else {
            setEditingBatch(batch);
            setEditScope(null);
        }
    }, []);

    const handleBatchDelete = useCallback(
        (batch: PlanBatchWithProgress) => {
            if (batch.recurrence_rule_id) {
                setScopeBatch(batch);
                setIsDeleteScopeModalOpen(true);
            } else {
                if (window.confirm(i18n.t('schedule.deleteConfirm.batch', { name: batch.bean_name }))) {
                    deleteSingleBatch.mutate({ id: batch.id });
                }
            }
        },
        [deleteSingleBatch],
    );

    const handleEditScopeConfirm = useCallback(
        (scope: EditScope) => {
            if (!scopeBatch) return;
            setEditScope(scope);
            setEditingBatch(scopeBatch);
            setIsEditScopeModalOpen(false);
            setScopeBatch(null);
        },
        [scopeBatch],
    );

    const handleEditScopeUpdate = useCallback(
        async (data: NewBatchData) => {
            if (!editScope || !editingBatch?.recurrence_rule_id) return;

            const basePatch = {
                id: editingBatch.id,
                plan_id: '',
                bean_name: data.beanName || editingBatch.bean_name,
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

            if (editScope === 'single') {
                let targetPlanId = editingBatch.plan_id;
                if (!targetPlanId && editingBatch.recurrence_rule_id) {
                    const scheduleDate = editingBatch.scheduled_date ?? dateKey;
                    const plan = await dayPlanApi.getOrCreate(userId, scheduleDate);
                    targetPlanId = plan.id;
                }
                await updateSingleBatch.mutateAsync({
                    id: editingBatch.id,
                    patch: { ...basePatch, plan_id: targetPlanId ?? '' },
                    meta: {
                        recurrenceRuleId: editingBatch.recurrence_rule_id,
                        originalDate: editingBatch.scheduled_date ?? dateKey,
                    },
                });
            } else {
                const instanceDate = editingBatch.scheduled_date ?? dateKey;
                const masterPatch = {
                    machine_id: data.machineId || null,
                    roast_profile_id: data.profileId,
                    bean_id: data.beanId,
                    blend_id: data.blendId ?? null,
                    bean_name: data.beanName || editingBatch.bean_name,
                    green_lot: data.greenLot,
                    batch_size_kg: data.batchSize,
                    yield_pct: data.yieldPct / 100,
                    target_roasted_kg: data.targetRoasted,
                    notes: data.notes,
                    batch_type: data.batchType,
                    ...(data.recurringInterval ? { rrule: buildRRule(data.recurringInterval) } : {}),
                };

                if (editScope === 'from_this') {
                    await updateFromThis.mutateAsync({
                        ruleId: editingBatch.recurrence_rule_id,
                        fromDate: instanceDate,
                        patch: { ...masterPatch, dtstart: instanceDate, userId },
                    });
                } else if (editScope === 'all') {
                    await updateAllBatches.mutateAsync({
                        ruleId: editingBatch.recurrence_rule_id,
                        patch: masterPatch,
                    });
                }
            }
        },
        [editScope, editingBatch, updateSingleBatch, updateFromThis, updateAllBatches, dateKey, userId],
    );

    const handleEditBatch = useCallback(
        async (data: NewBatchData) => {
            if (!editingBatch) return;

            const newDateKey = format(data.date, 'yyyy-MM-dd');
            const dateChanged = newDateKey !== dateKey;
            const isBlendType = data.batchType === 'Pre-roast Blend' || data.batchType === 'Post-roast Blend';
            let targetPlanId = editingBatch.plan_id;
            const oldPlanId = editingBatch.plan_id;

            if (dateChanged) {
                const newPlan = await dayPlanApi.getOrCreate(userId, newDateKey);
                targetPlanId = newPlan.id;
                await planBatchApi.move(editingBatch.id, targetPlanId);
            }

            await updateSingleBatch.mutateAsync({
                id: editingBatch.id,
                patch: {
                    id: editingBatch.id,
                    plan_id: targetPlanId,
                    machine_id: data.machineId || null,
                    batch_type: data.batchType,
                    roast_profile_id: data.profileId,
                    bean_id: isBlendType ? null : data.beanId,
                    blend_id: isBlendType ? data.blendId : null,
                    bean_name: data.beanName || editingBatch.bean_name,
                    target_roasted_kg: data.targetRoasted,
                    batch_size_kg: data.batchSize,
                    yield_pct: data.yieldPct / 100,
                    green_lot: data.greenLot,
                    notes: data.notes,
                },
            });

            if (dateChanged) {
                qc.invalidateQueries({ queryKey: planKeys.batches(oldPlanId) });
                qc.invalidateQueries({ queryKey: planKeys.batches(targetPlanId) });
                qc.invalidateQueries({ queryKey: planKeys.dayBatches(userId, dateKey) });
                qc.invalidateQueries({ queryKey: planKeys.dayBatches(userId, newDateKey) });
            }
        },
        [editingBatch, dateKey, userId, updateSingleBatch, qc],
    );

    const handleNewBatch = useCallback(
        async (data: NewBatchData) => {
            const baseBatch: Omit<PlanBatchInsert, 'plan_id'> = {
                order_index: batches.length,
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
                await createBatch.mutateAsync({ ...baseBatch, plan_id: planId } as PlanBatchInsert);
            }
        },
        [planId, batches.length, createBatch, createRecurringBatches],
    );

    const handleSaveBatch = useCallback(
        async (data: NewBatchData) => {
            try {
                if (editingBatch) {
                    if (editScope && editingBatch.recurrence_rule_id) {
                        await handleEditScopeUpdate(data);
                    } else {
                        await handleEditBatch(data);
                    }
                } else {
                    await handleNewBatch(data);
                }
            } catch (err) {
                const key = editingBatch
                    ? 'addBatchModal.saveFailed'
                    : data.recurringInterval
                      ? 'schedule.error.createRecurring'
                      : 'schedule.error.createBatch';
                alert(i18n.t(key) + ` ${err instanceof Error ? err.message : String(err)}`);
                throw err;
            }
        },
        [editingBatch, editScope, handleEditScopeUpdate, handleEditBatch, handleNewBatch],
    );

    const handleMove = useCallback(
        (index: number, dir: 'up' | 'down') => {
            const batch = batches[index];
            if (batch?.recurrence_rule_id) return;

            const next = [...batches];
            const swapWith = dir === 'up' ? index - 1 : index + 1;
            [next[index], next[swapWith]] = [next[swapWith], next[index]];
            reorderBatches.mutate(next.map((b) => b.id));
        },
        [batches, reorderBatches],
    );

    const handleStart = useCallback(
        async (batch: PlanBatchWithProgress) => {
            const handoffBeanId = batch.bean_id;
            const handoffBlendId = batch.blend_id ?? null;
            const handoffProfileId = batch.roast_profile_id;

            try {
                const result = await commitStatusTransition(batch, 'in-progress');
                const targetId = result.targetId;
                const targetPlanId = result.targetPlanId;

                onStartBatch({
                    planBatchId: targetId,
                    planId: targetPlanId,
                    beanId: handoffBeanId,
                    blendId: handoffBlendId,
                    beanName: batch.bean_name,
                    batchSizeKg: Number(batch.batch_size_kg),
                    profileId: handoffProfileId,
                    batchCount: batch.batch_count,
                    completedSessions: batch.completed_sessions,
                });
            } catch (_err) {}
        },
        [commitStatusTransition, onStartBatch],
    );

    const handleCompleteClick = useCallback((batch: PlanBatchWithProgress) => {
        setCompletingBatch(batch);
        setIsCompleteModalOpen(true);
    }, []);

    const handleCompleteClose = useCallback(() => {
        setIsCompleteModalOpen(false);
        setCompletingBatch(null);
    }, []);

    const handleCompleteConfirm = useCallback(
        async (deductStock: boolean) => {
            const batch = completingBatch;
            if (!batch) return;

            try {
                const { targetId } = await commitStatusTransition(batch, 'done');

                if (deductStock) {
                    const deductionGrams = batchGreenNeededGramsFromBatch(batch);
                    if (deductionGrams > 0 && (batch.bean_id || batch.blend_id)) {
                        await deductRoastStock({
                            deductionGrams,
                            singleBeanId: batch.bean_id ?? null,
                            blendId: batch.blend_id ?? null,
                            referenceId: targetId,
                        });
                    }
                }
            } catch (err) {
                alert(`${i18n.t('schedule.error.completeBatch')} ${err instanceof Error ? err.message : String(err)}`);
            } finally {
                handleCompleteClose();
            }
        },
        [completingBatch, commitStatusTransition, deductRoastStock, handleCompleteClose],
    );

    const isRecurringStockShort = useCallback(
        (batch: PlanBatchWithProgress) => {
            if (!batch.recurrence_rule_id || !batch.bean_id) return false;
            return isBatchStockShort(batch, stockSummaries[batch.bean_id]?.effectiveGrams);
        },
        [stockSummaries],
    );

    const recurringStockShortDetail = useCallback(
        (batch: PlanBatchWithProgress) => {
            if (!batch.bean_id) return null;
            const neededKg = (batchGreenNeededGramsFromBatch(batch) / 1000).toFixed(1);
            const availableKg = ((stockSummaries[batch.bean_id]?.effectiveGrams ?? 0) / 1000).toFixed(1);
            return { neededKg, availableKg };
        },
        [stockSummaries],
    );

    const clearEditScope = useCallback(() => {
        setIsEditScopeModalOpen(false);
        setScopeBatch(null);
        setEditScope(null);
    }, []);

    const clearDeleteScope = useCallback(() => {
        setIsDeleteScopeModalOpen(false);
        setScopeBatch(null);
    }, []);

    const clearAddModal = useCallback(() => {
        setIsAddModalOpen(false);
        setEditingBatch(null);
        setEditScope(null);
    }, []);

    const clearEditState = useCallback(() => {
        setEditingBatch(null);
        setEditScope(null);
    }, []);

    return {
        isLoading,
        isAddModalOpen,
        setIsAddModalOpen,
        batches,
        overdueBatches,
        editingBatch,
        editScope,
        scopeBatch,
        isEditScopeModalOpen,
        isDeleteScopeModalOpen,
        handleSaveBatch,
        handleMove,
        handleStart,
        handleCompleteClick,
        handleCompleteConfirm,
        handleCompleteClose,
        completingBatch,
        isCompleteModalOpen,
        handleEdit,
        handleBatchDelete,
        handleEditScopeConfirm,
        handleScopeDelete,
        clearEditScope,
        clearDeleteScope,
        clearAddModal,
        clearEditState,
        isRecurringStockShort,
        recurringStockShortDetail,
    };
};
