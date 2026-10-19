import type { PlanBatchHandoff } from '@shared/types/database.types';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { AddBatchModal } from '@widgets/add-batch-modal';
import { CompleteBatchModal } from '@widgets/complete-batch-modal';
import { RecurringDeleteScopeModal, RecurringEditScopeModal } from '@widgets/recurring-edit-scope-modal';
import { Clock, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BatchCard } from './BatchCard';
import { BatchCardSkeleton } from './BatchCardSkeleton';
import { useScheduleDayView } from './hooks/useScheduleDayView';
import { batchStatus, getRecurrenceLabel, toDateKey } from './lib';

export const ScheduleDayView = ({
    selectedDate,
    userId,
    onStartBatch,
}: {
    selectedDate: Date;
    userId: string;
    onStartBatch: (handoff: PlanBatchHandoff) => void;
}) => {
    const { t } = useTranslation();
    const dateKey = toDateKey(selectedDate);
    const hooks = useScheduleDayView({ userId, selectedDate, onStartBatch });

    const scopeBatchLabel = hooks.scopeBatch
        ? `${hooks.scopeBatch.bean_name} / ${hooks.scopeBatch.batch_size_kg}kg`
        : '';
    const scopeRecurrenceKey = hooks.scopeBatch ? getRecurrenceLabel(hooks.scopeBatch.rrule) || 'repeat' : '';
    const scopeRecurrenceLabel = scopeRecurrenceKey ? t(`schedule.recurrence.${scopeRecurrenceKey}`) : '';
    const scopeIsFirstInstance =
        !!hooks.scopeBatch &&
        batchStatus(hooks.scopeBatch) === 'pending' &&
        hooks.batches.indexOf(hooks.scopeBatch) === 0;

    return (
        <>
            <div className="shrink-0 border-b border-divider bg-main-bg px-6 py-2.5 flex items-center gap-2">
                <SurfaceButton
                    onClick={() => hooks.setIsAddModalOpen(true)}
                    disabled={hooks.isLoading}
                    icon={<Plus size={13} strokeWidth={2} />}
                >
                    {t('schedule.addBatch')}
                </SurfaceButton>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                {/* Overdue Section — inside the scroll area so it scrolls with the day's batches */}
                {hooks.overdueBatches.length > 0 && (
                    <div className="bg-amber-50/40 dark:bg-amber-950/8 rounded-xl px-4 py-4 mb-4">
                        <div className="flex items-center gap-2 mb-3">
                            <Clock size={14} strokeWidth={1.5} className="text-amber-600 dark:text-amber-400" />
                            <span className="text-[13px] font-semibold text-amber-700 dark:text-amber-400">
                                {t('schedule.overdue.title', { count: hooks.overdueBatches.length })}
                            </span>
                        </div>
                        <div className="space-y-3">
                            {hooks.overdueBatches.map((batch) => (
                                <BatchCard
                                    key={`overdue-${batch.id}`}
                                    batch={batch}
                                    index={-1}
                                    total={-1}
                                    isOverdue={true}
                                    onMove={() => {}}
                                    onDelete={() => hooks.handleBatchDelete(batch)}
                                    onStart={() => hooks.handleStart(batch)}
                                    onComplete={() => hooks.handleCompleteClick(batch)}
                                    onEdit={() => hooks.handleEdit(batch)}
                                    stockShort={hooks.isRecurringStockShort(batch)}
                                    stockShortDetail={hooks.recurringStockShortDetail(batch)}
                                />
                            ))}
                        </div>
                    </div>
                )}
                {hooks.isLoading ? (
                    <div className="space-y-3" role="status" aria-busy="true" aria-label={t('schedule.loading')}>
                        <BatchCardSkeleton />
                        <BatchCardSkeleton />
                        <BatchCardSkeleton />
                    </div>
                ) : hooks.batches.length === 0 ? (
                    <div className="bg-main-bg dark:border dark:border-[#585d61] rounded-xl px-4 py-12 flex flex-col items-center justify-center gap-4 select-none">
                        <div className="text-[13px] text-muted text-center leading-relaxed">
                            {t('schedule.emptyState.title')}
                        </div>
                        <SurfaceButton
                            onClick={() => hooks.setIsAddModalOpen(true)}
                            icon={<Plus size={14} strokeWidth={2} />}
                            className="px-4 py-2"
                        >
                            {t('schedule.addBatch')}
                        </SurfaceButton>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {hooks.batches.map((batch, index) => (
                            <BatchCard
                                key={batch.id}
                                batch={batch}
                                index={index}
                                total={hooks.batches.length}
                                stockShort={hooks.isRecurringStockShort(batch)}
                                stockShortDetail={hooks.recurringStockShortDetail(batch)}
                                onMove={(dir) => hooks.handleMove(index, dir)}
                                onDelete={() => hooks.handleBatchDelete(batch)}
                                onStart={() => hooks.handleStart(batch)}
                                onComplete={() => hooks.handleCompleteClick(batch)}
                                onEdit={() => hooks.handleEdit(batch)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {hooks.scopeBatch && (
                <>
                    <RecurringEditScopeModal
                        open={hooks.isEditScopeModalOpen}
                        onClose={hooks.clearEditScope}
                        onConfirm={hooks.handleEditScopeConfirm}
                        batchLabel={scopeBatchLabel}
                        recurrenceLabel={scopeRecurrenceLabel}
                        isFirstInstance={scopeIsFirstInstance}
                    />
                    <RecurringDeleteScopeModal
                        open={hooks.isDeleteScopeModalOpen}
                        onClose={hooks.clearDeleteScope}
                        onConfirm={(scope) => hooks.scopeBatch && hooks.handleScopeDelete(scope, hooks.scopeBatch)}
                        batchLabel={scopeBatchLabel}
                        recurrenceLabel={scopeRecurrenceLabel}
                        isFirstInstance={scopeIsFirstInstance}
                    />
                </>
            )}

            <CompleteBatchModal
                open={hooks.isCompleteModalOpen}
                batch={hooks.completingBatch}
                onClose={hooks.handleCompleteClose}
                onConfirm={hooks.handleCompleteConfirm}
                confirmDisabled={hooks.isCompleteConfirmDisabled}
            />

            <AddBatchModal
                open={hooks.isAddModalOpen || hooks.editingBatch !== null}
                onClose={hooks.clearAddModal}
                onSave={hooks.handleSaveBatch}
                editingBatch={hooks.editingBatch}
                editScope={hooks.editScope}
                currentDateKey={dateKey}
                onSaved={hooks.clearEditState}
            />
        </>
    );
};
