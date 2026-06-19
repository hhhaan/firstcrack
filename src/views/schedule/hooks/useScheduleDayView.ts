import {
    dayPlanApi,
    planBatchApi,
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
import { getDateFnsLocale, i18n } from '@shared/i18n';
import { buildRRule } from '@shared/lib/rrule';
import type { PlanBatchHandoff, PlanBatchInsert, PlanBatchWithProgress } from '@shared/types/database.types';
import type { NewBatchData } from '@widgets/add-batch-modal';
import type { EditScope } from '@widgets/recurring-edit-scope-modal';
import { format } from 'date-fns';
import { useCallback, useState } from 'react';
import { toDateKey } from '../lib';

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
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingBatch, setEditingBatch] = useState<PlanBatchWithProgress | null>(null);
    const [editScope, setEditScope] = useState<EditScope | null>(null);
    const [scopeBatch, setScopeBatch] = useState<PlanBatchWithProgress | null>(null);
    const [isEditScopeModalOpen, setIsEditScopeModalOpen] = useState(false);
    const [isDeleteScopeModalOpen, setIsDeleteScopeModalOpen] = useState(false);

    const { data: dayPlan, isLoading: isDayPlanLoading } = useDayPlan(userId, dateKey);
    const planId = dayPlan?.id ?? '';

    const { data: batches = [], isLoading: isBatchesLoading } = useDayBatches(userId, dateKey);
    const isLoading = isDayPlanLoading || isBatchesLoading;

    const createBatch = useCreatePlanBatch(planId);
    const reorderBatches = useReorderPlanBatches(planId);
    const createRecurringBatches = useCreateRecurringBatches(userId, planId);
    const deleteSingleBatch = useDeleteSingleBatch();
    const deleteFromThis = useDeleteFromThis();
    const deleteAllBatches = useDeleteAllBatches();
    const updateSingleBatch = useUpdateSingleBatch();
    const updateFromThis = useUpdateFromThis();
    const updateAllBatches = useUpdateAllBatches();

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

    const handleDeleteScopeConfirm = useCallback(
        (scope: EditScope) => {
            if (!scopeBatch) return;
            handleScopeDelete(scope, scopeBatch);
        },
        [scopeBatch, handleScopeDelete],
    );

    const handleAddBatch = useCallback(
        async (data: NewBatchData) => {
            if (editScope && editingBatch?.recurrence_rule_id) {
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
                    updateSingleBatch.mutate({
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
                        updateFromThis.mutate({
                            ruleId: editingBatch.recurrence_rule_id,
                            fromDate: instanceDate,
                            patch: { ...masterPatch, dtstart: instanceDate, userId },
                        });
                    } else if (editScope === 'all') {
                        updateAllBatches.mutate({
                            ruleId: editingBatch.recurrence_rule_id,
                            patch: masterPatch,
                        });
                    }
                }
                return;
            }

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
                createRecurringBatches.mutate(
                    { baseBatch, interval: data.recurringInterval, dtstart: data.date },
                    {
                        onError: (err) => {
                            console.error('[Schedule] createRecurringBatches failed:', err);
                            alert(
                                i18n.t('schedule.error.createRecurring') +
                                    ` ${err instanceof Error ? err.message : String(err)}`,
                            );
                        },
                    },
                );
            } else if (planId) {
                createBatch.mutate({ ...baseBatch, plan_id: planId } as PlanBatchInsert, {
                    onError: (err) => {
                        console.error('[Schedule] createBatch failed:', err);
                        alert(
                            i18n.t('schedule.error.createBatch') +
                                ` ${err instanceof Error ? err.message : String(err)}`,
                        );
                    },
                });
            }
        },
        [
            planId,
            batches.length,
            createBatch,
            createRecurringBatches,
            editScope,
            editingBatch,
            updateSingleBatch,
            updateFromThis,
            updateAllBatches,
            dateKey,
            userId,
        ],
    );

    const handleMove = useCallback(
        (index: number, dir: 'up' | 'down') => {
            const next = [...batches];
            const swapWith = dir === 'up' ? index - 1 : index + 1;
            [next[index], next[swapWith]] = [next[swapWith], next[index]];
            reorderBatches.mutate(next.map((b) => b.id));
        },
        [batches, reorderBatches],
    );

    const handleStart = useCallback(
        async (batch: PlanBatchWithProgress) => {
            let targetId = batch.id;
            let targetPlanId = batch.plan_id;

            if (!batch.plan_id && batch.recurrence_rule_id && batch.scheduled_date) {
                try {
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
                            roast_profile_id: batch.roast_profile_id,
                            notes: batch.notes,
                            green_lot: batch.green_lot,
                            batch_type: batch.batch_type,
                            status: 'in-progress',
                        },
                    );
                    targetId = realBatch.id;
                    targetPlanId = realBatch.plan_id;
                } catch (err) {
                    console.error('[Schedule] materialize failed:', err);
                    return;
                }
            } else if (targetPlanId) {
                updateSingleBatch.mutate({
                    id: batch.id,
                    patch: {
                        id: batch.id,
                        plan_id: batch.plan_id,
                        status: 'in-progress',
                    },
                    ...(batch.recurrence_rule_id && batch.original_date
                        ? {
                              meta: {
                                  recurrenceRuleId: batch.recurrence_rule_id,
                                  originalDate: batch.original_date,
                              },
                          }
                        : {}),
                });
            }

            onStartBatch({
                planBatchId: targetId,
                planId: targetPlanId,
                beanId: batch.bean_id,
                blendId: (batch as PlanBatchWithProgress & { blend_id?: string | null }).blend_id ?? null,
                beanName: batch.bean_name,
                batchSizeKg: Number(batch.batch_size_kg),
                profileId: batch.roast_profile_id,
                batchCount: batch.batch_count,
                completedSessions: batch.completed_sessions,
            });
        },
        [updateSingleBatch, onStartBatch, userId],
    );

    return {
        isLoading,
        isAddModalOpen,
        setIsAddModalOpen,
        batches,
        editingBatch,
        editScope,
        scopeBatch,
        isEditScopeModalOpen,
        setIsEditScopeModalOpen,
        isDeleteScopeModalOpen,
        setIsDeleteScopeModalOpen,
        setEditingBatch,
        setEditScope,
        setScopeBatch,
        handleAddBatch,
        handleMove,
        handleStart,
        handleEdit,
        handleBatchDelete,
        handleEditScopeConfirm,
        handleDeleteScopeConfirm,
    };
};
