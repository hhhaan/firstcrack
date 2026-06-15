import { Package, ChevronUp, ChevronDown, Play, Pencil, Trash2 } from 'lucide-react';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { batchStatus, batchProgress, getRecurrenceLabel } from './lib';

const statusStyles: Record<string, string> = {
    pending: 'bg-palette-lavender/10 text-palette-lavender',
    'in-progress': 'bg-palette-blue/12 text-palette-blue border border-palette-blue/20',
    done: 'bg-palette-green/12 text-palette-green border border-palette-green/20',
    skipped: 'text-palette-lavender bg-palette-lavender/10 line-through',
};

const statusLabels: Record<string, string> = {
    pending: '대기',
    'in-progress': '진행중',
    done: '완료',
    skipped: '건너뜀',
};

export const BatchCard = ({
    batch,
    index,
    total,
    onMove,
    onDelete,
    onStart,
    onEdit,
}: {
    batch: PlanBatchWithProgress;
    index: number;
    total: number;
    onMove: (dir: 'up' | 'down') => void;
    onDelete: () => void;
    onStart: () => void;
    onEdit: () => void;
}) => {
    const status = batchStatus(batch);
    const canStart = status === 'pending' || status === 'in-progress';
    const isRecurring = !!batch.recurrence_rule_id;

    return (
        <div className="flex gap-2">
            <div className="flex flex-col gap-1 pt-1 shrink-0">
                <button
                    onClick={() => onMove('up')}
                    disabled={index === 0}
                    className="w-6 h-6 rounded-md flex items-center justify-center border-none bg-surface text-muted cursor-pointer hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronUp size={13} strokeWidth={2} />
                </button>
                <button
                    onClick={() => onMove('down')}
                    disabled={index === total - 1}
                    className="w-6 h-6 rounded-md flex items-center justify-center border-none bg-surface text-muted cursor-pointer hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronDown size={13} strokeWidth={2} />
                </button>
            </div>
            <div className="flex-1 rounded-xl p-4 bg-main-bg transition-colors duration-150">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Package size={14} strokeWidth={1.5} color="var(--color-muted)" className="shrink-0 mt-[1px]" />
                        <span className="text-[14px] font-semibold text-primary">{batch.bean_name}</span>
                        {isRecurring && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-palette-lavender/15 text-palette-lavender border border-palette-lavender/25">
                                {getRecurrenceLabel(batch.rrule)}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-md ${statusStyles[status]}`}>
                            {status === 'in-progress' ? `진행중 ${batchProgress(batch)}` : statusLabels[status]}
                        </span>
                        {canStart && (
                            <button
                                onClick={onStart}
                                className="flex items-center gap-1 text-[12px] font-medium text-white bg-primary dark:bg-[#171717] px-2.5 py-1 rounded-lg border-none cursor-pointer hover:opacity-90 transition-opacity"
                            >
                                <Play size={11} strokeWidth={2.5} />
                                시작
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
                        <span>
                            목표 <span className="font-medium text-primary">{batch.target_roasted_kg} kg</span>
                        </span>
                        <span className="text-border-subtle">│</span>
                        <span>
                            Batch <span className="font-medium text-primary">{batch.batch_size_kg} kg</span>
                        </span>
                        <span className="text-border-subtle">│</span>
                        <span className="font-medium text-primary">{batch.batch_count}회</span>
                        {batch.machine_id && (
                            <>
                                <span className="text-border-subtle">│</span>
                                <span>{batch.machine_id}</span>
                            </>
                        )}
                    </div>
                    {batch.notes && <div className="text-[12px] text-muted">{batch.notes}</div>}
                </div>
            </div>
        </div>
    );
};
