import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Package, Pencil, Play, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { batchProgress, batchStatus, getRecurrenceLabel } from './lib';

const statusStyles: Record<string, string> = {
    pending: 'bg-palette-lavender/10 text-palette-lavender',
    'in-progress': 'bg-palette-blue/12 text-palette-blue border border-palette-blue/20',
    done: 'bg-palette-green/12 text-palette-green border border-palette-green/20',
    skipped: 'text-palette-lavender bg-palette-lavender/10 line-through',
};

export const BatchCard = ({
    batch,
    index,
    total,
    onMove,
    onDelete,
    onStart,
    onComplete,
    onEdit,
    stockShort = false,
    stockShortDetail,
}: {
    batch: PlanBatchWithProgress;
    index: number;
    total: number;
    onMove: (dir: 'up' | 'down') => void;
    onDelete: () => void;
    onStart: () => void;
    onComplete: () => void;
    onEdit: () => void;
    stockShort?: boolean;
    stockShortDetail?: { neededKg: string; availableKg: string } | null;
}) => {
    const { t } = useTranslation();
    const status = batchStatus(batch);
    const isActive = status === 'pending' || status === 'in-progress';
    const isRecurring = !!batch.recurrence_rule_id;
    const canReorder = !isRecurring;
    const reorderTitle = isRecurring ? t('schedule.reorderDisabledRecurring') : undefined;

    return (
        <div className="rounded-xl p-4 bg-main-bg dark:bg-[#262b31] transition-colors duration-150">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Package size={14} strokeWidth={1.5} color="var(--color-muted)" className="shrink-0 mt-[1px]" />
                    <span className="text-[14px] font-semibold text-primary">{batch.bean_name}</span>
                    {isRecurring && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-palette-lavender/15 text-palette-lavender border border-palette-lavender/25">
                            {t('schedule.recurrence.' + getRecurrenceLabel(batch.rrule))}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-md ${statusStyles[status]}`}>
                        {status === 'in-progress'
                            ? t('schedule.status.inProgressWith', { progress: batchProgress(batch) })
                            : t('schedule.status.' + status)}
                    </span>
                    {isActive && (
                        <button
                            onClick={onStart}
                            className="flex items-center gap-1 text-[12px] font-medium text-white bg-primary dark:bg-[#171717] px-2.5 py-1 rounded-lg border-none cursor-pointer hover:opacity-90 transition-opacity"
                        >
                            <Play size={11} strokeWidth={2.5} />
                            {t('schedule.start')}
                        </button>
                    )}
                    {isActive && (
                        <button
                            onClick={onComplete}
                            className="flex items-center gap-1 text-[12px] font-medium text-secondary bg-surface dark:bg-surface-elevated px-2.5 py-1 rounded-full border border-border-subtle cursor-pointer hover:text-primary transition-colors"
                        >
                            <Check size={11} strokeWidth={2.5} />
                            {t('schedule.complete')}
                        </button>
                    )}
                    <button
                        onClick={onEdit}
                        className="w-6 h-6 rounded-md flex items-center justify-center border-none bg-transparent text-muted cursor-pointer hover:text-primary transition-colors"
                    >
                        <Pencil size={12} strokeWidth={1.5} />
                    </button>
                    <button
                        onClick={onDelete}
                        className="w-6 h-6 rounded-md flex items-center justify-center border-none bg-transparent text-muted cursor-pointer hover:text-red-500 transition-colors"
                    >
                        <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                </div>
            </div>
            <div className="mt-2.5 pl-[22px] space-y-1">
                <div className="text-[12px] text-secondary flex flex-wrap items-center gap-x-2.5">
                    <span className="font-medium text-primary">
                        {t('schedule.detail.target', { kg: batch.target_roasted_kg })}
                    </span>
                    <span className="text-border-subtle">│</span>
                    <span className="font-medium text-primary">
                        {t('schedule.detail.batch', { kg: batch.batch_size_kg })}
                    </span>
                    <span className="text-border-subtle">│</span>
                    <span className="font-medium text-primary">
                        {t('schedule.detail.count', { count: batch.batch_count })}
                    </span>
                    {batch.machine_id && (
                        <>
                            <span className="text-border-subtle">│</span>
                            <span>{batch.machine_id}</span>
                        </>
                    )}
                </div>
                {batch.notes && <div className="text-[12px] text-muted">{batch.notes}</div>}
                {isRecurring && stockShort && stockShortDetail && (
                    <div className="flex items-start gap-1.5 text-[11px] text-amber-600 font-medium pt-1">
                        <AlertTriangle size={12} strokeWidth={2} className="shrink-0 mt-0.5" />
                        <span>
                            {t('schedule.stockShortRecurring', {
                                needed: stockShortDetail.neededKg,
                                available: stockShortDetail.availableKg,
                            })}
                        </span>
                    </div>
                )}
            </div>
            <div className="mt-3 pl-[22px] flex items-center gap-1">
                {(
                    [
                        { dir: 'up', Icon: ChevronUp },
                        { dir: 'down', Icon: ChevronDown },
                    ] as const
                ).map(({ dir, Icon }) => (
                    <button
                        key={dir}
                        type="button"
                        onClick={() => onMove(dir)}
                        disabled={!canReorder || (dir === 'up' ? index === 0 : index === total - 1)}
                        title={reorderTitle}
                        className="w-6 h-6 rounded-md flex items-center justify-center border-none bg-surface dark:bg-surface-elevated text-muted cursor-pointer hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <Icon size={13} strokeWidth={2} />
                    </button>
                ))}
            </div>
        </div>
    );
};
