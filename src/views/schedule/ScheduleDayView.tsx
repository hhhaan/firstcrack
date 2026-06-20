import type { PlanBatchHandoff } from '@shared/types/database.types';
import { AddBatchModal } from '@widgets/add-batch-modal';
import { CompleteBatchModal } from '@widgets/complete-batch-modal';
import { RecurringDeleteScopeModal, RecurringEditScopeModal } from '@widgets/recurring-edit-scope-modal';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BatchCard } from './BatchCard';
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

    return (
        <>
            <div className="shrink-0 border-b border-border-subtle dark:border-[#585d61] bg-main-bg px-8 py-2.5 flex items-center gap-2">
                <button
                    onClick={() => hooks.setIsAddModalOpen(true)}
                    disabled={hooks.isLoading}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-primary px-3 py-1.5 rounded-lg bg-surface dark:bg-surface-elevated cursor-pointer hover:bg-surface-raised transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Plus size={13} strokeWidth={2} />
                    {t('schedule.addBatch')}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-6">
                {hooks.isLoading ? (
                    <div className="text-[13px] text-muted text-center py-12">{t('schedule.loading')}</div>
                ) : hooks.batches.length === 0 ? (
                    <div className="bg-main-bg dark:border dark:border-[#585d61] rounded-xl px-4 py-12 flex flex-col items-center justify-center gap-4 select-none">
                        <div className="text-[13px] text-muted text-center leading-relaxed">
                            {t('schedule.emptyState.title')}
                        </div>
                        <button
                            onClick={() => hooks.setIsAddModalOpen(true)}
                            className="flex items-center gap-1.5 text-[13px] font-medium text-primary px-4 py-2 rounded-lg bg-surface dark:bg-surface-elevated cursor-pointer hover:bg-surface-raised transition-colors"
                        >
                            <Plus size={14} strokeWidth={2} />
                            {t('schedule.addBatch')}
                        </button>
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
                        onClose={() => {
                            hooks.setIsEditScopeModalOpen(false);
                            hooks.setScopeBatch(null);
                            hooks.setEditScope(null);
                        }}
                        onConfirm={hooks.handleEditScopeConfirm}
                        batchLabel={`${hooks.scopeBatch.bean_name} / ${hooks.scopeBatch.batch_size_kg}kg`}
                        recurrenceLabel={t('schedule.recurrence.' + getRecurrenceLabel(hooks.scopeBatch.rrule))}
                        isFirstInstance={
                            batchStatus(hooks.scopeBatch) === 'pending' && hooks.batches.indexOf(hooks.scopeBatch) === 0
                        }
                    />
                    <RecurringDeleteScopeModal
                        open={hooks.isDeleteScopeModalOpen}
                        onClose={() => {
                            hooks.setIsDeleteScopeModalOpen(false);
                            hooks.setScopeBatch(null);
                        }}
                        onConfirm={hooks.handleDeleteScopeConfirm}
                        batchLabel={`${hooks.scopeBatch.bean_name} / ${hooks.scopeBatch.batch_size_kg}kg`}
                        recurrenceLabel={t('schedule.recurrence.' + getRecurrenceLabel(hooks.scopeBatch.rrule))}
                        isFirstInstance={
                            batchStatus(hooks.scopeBatch) === 'pending' && hooks.batches.indexOf(hooks.scopeBatch) === 0
                        }
                    />
                </>
            )}

            <CompleteBatchModal
                open={hooks.isCompleteModalOpen}
                batch={hooks.completingBatch}
                onClose={hooks.handleCompleteClose}
                onConfirm={hooks.handleCompleteConfirm}
            />

            <AddBatchModal
                key={String(hooks.isAddModalOpen) + (hooks.editingBatch?.id ?? '') + (hooks.editScope ?? '')}
                open={hooks.isAddModalOpen || hooks.editingBatch !== null}
                onClose={() => {
                    hooks.setIsAddModalOpen(false);
                    hooks.setEditingBatch(null);
                    hooks.setEditScope(null);
                }}
                onAdd={hooks.handleAddBatch}
                editingBatch={hooks.editingBatch}
                editScope={hooks.editScope}
                currentDateKey={dateKey}
                onSaved={() => {
                    hooks.setEditingBatch(null);
                    hooks.setEditScope(null);
                }}
            />
        </>
    );
};
