import { useBeanStockSummaries } from '@entities/bean-stock-event';
import { useActiveWorkspace } from '@entities/organization';
import { useDayBatches, useDayPlan } from '@entities/plan';
import { type RoastPhase, useRoastingStore } from '@features/active-roast';
import { type EditScope, type NewBatchData, usePlanDayWrites } from '@features/schedule';
import { getDateFnsLocale, i18n } from '@shared/i18n';
import { batchGreenNeededGramsFromBatch, isBatchStockShort } from '@shared/lib/batch-stock';
import { logger } from '@shared/lib/logger';
import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import { confirm } from '@tauri-apps/plugin-dialog';
import { format } from 'date-fns';
import { useCallback, useMemo, useState } from 'react';
import { batchStatus, toDateKey, unknownErrorMessage } from '../lib';

/** Live/unsaved roast blocks schedule Start. Machine connected (preheating/standby) does not. */
export function isRoastBlockingScheduleStart(phase: RoastPhase): boolean {
    return phase === 'roasting' || phase === 'ended';
}

/**
 * Day view state: queries, modal flags, and the user prompts (confirm/alert) around
 * each write. The writes themselves live in `features/schedule` (`usePlanDayWrites`).
 */
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
    const [completingBatch, setCompletingBatch] = useState<PlanBatchWithProgress | null>(null);
    const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);

    const { isWorkspaceReady } = useActiveWorkspace();

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

    const writes = usePlanDayWrites({ userId, dateKey, planId, batches });

    const handleScopeDelete = useCallback(
        async (scope: EditScope, batch: PlanBatchWithProgress) => {
            if (!batch.recurrence_rule_id) return;
            const confirmed =
                scope === 'single'
                    ? await confirm(i18n.t('schedule.deleteConfirm.single'))
                    : scope === 'from_this'
                      ? await confirm(
                            i18n.t('schedule.deleteConfirm.fromThis', {
                                date: format(selectedDate, i18n.t('schedule.dateFormat'), {
                                    locale: getDateFnsLocale(),
                                }),
                            }),
                        )
                      : await confirm(i18n.t('schedule.deleteConfirm.all'));
            if (confirmed) {
                writes.deleteRecurring(batch, scope).catch((err) => logger.error('Failed to delete batch:', err));
            }
            setIsDeleteScopeModalOpen(false);
            setScopeBatch(null);
        },
        [writes.deleteRecurring, selectedDate],
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
        async (batch: PlanBatchWithProgress) => {
            if (batch.recurrence_rule_id) {
                setScopeBatch(batch);
                setIsDeleteScopeModalOpen(true);
            } else if (await confirm(i18n.t('schedule.deleteConfirm.batch', { name: batch.bean_name }))) {
                writes.deleteBatch(batch).catch((err) => logger.error('Failed to delete batch:', err));
            }
        },
        [writes.deleteBatch],
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

    const handleSaveBatch = useCallback(
        async (data: NewBatchData) => {
            try {
                if (editingBatch) {
                    if (editScope && editingBatch.recurrence_rule_id) {
                        await writes.editRecurring(editingBatch, editScope, data);
                    } else {
                        await writes.editBatch(editingBatch, data);
                    }
                } else {
                    await writes.createBatch(data);
                }
            } catch (err) {
                const key = editingBatch
                    ? 'addBatchModal.saveFailed'
                    : data.recurringInterval
                      ? 'schedule.error.createRecurring'
                      : 'schedule.error.createBatch';
                alert(`${i18n.t(key)} ${unknownErrorMessage(err)}`);
                throw err;
            }
        },
        [editingBatch, editScope, writes.editRecurring, writes.editBatch, writes.createBatch],
    );

    const handleStart = useCallback(
        async (batch: PlanBatchWithProgress) => {
            if (isRoastBlockingScheduleStart(useRoastingStore.getState().phase)) {
                alert(i18n.t('schedule.error.roastInProgress'));
                return;
            }
            try {
                onStartBatch(await writes.startBatch(batch));
            } catch (err) {
                logger.error('Failed to start batch:', err);
                alert(`${i18n.t('schedule.error.startBatch')} ${unknownErrorMessage(err)}`);
            }
        },
        [writes.startBatch, onStartBatch],
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
                await writes.completeBatch(batch, deductStock, {
                    notify: (key) => alert(i18n.t(key)),
                });
            } catch (err) {
                logger.error('Failed to complete batch:', err);
                alert(`${i18n.t('schedule.error.completeBatch')} ${unknownErrorMessage(err)}`);
            } finally {
                handleCompleteClose();
            }
        },
        [completingBatch, writes.completeBatch, handleCompleteClose],
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
        handleMove: writes.moveBatch,
        handleStart,
        handleCompleteClick,
        handleCompleteConfirm,
        handleCompleteClose,
        completingBatch,
        isCompleteModalOpen,
        isCompleteConfirmDisabled: !isWorkspaceReady,
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
