import { useState, useCallback } from 'react';
import {
    format,
    addDays,
    addWeeks,
    addMonths,
    startOfWeek,
    endOfWeek,
    startOfMonth,
    endOfMonth,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    isToday,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import {
    Plus,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    ChevronDown,
    Play,
    Trash2,
    Package,
    Pencil,
} from 'lucide-react';
import { useAuthStore } from '@shared/store/auth';
import { AddBatchModal, EditBatchModal, type NewBatchData } from '@widgets/add-batch-modal';
import {
    useDayPlan,
    usePlanBatches,
    useCreatePlanBatch,
    useDeletePlanBatch,
    useUpdatePlanBatch,
    useReorderPlanBatches,
    useMonthSummary,
    useWeekSummary,
} from '@entities/plan';
import type { DayPlanSummary } from '@entities/plan';
import type { PlanBatchWithProgress, PlanBatchHandoff } from '@shared/types/database.types';

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = 'day' | 'week' | 'month';

// ── Helpers ───────────────────────────────────────────────────────────────────

const toDateKey = (d: Date): string => format(d, 'yyyy-MM-dd');

const toFullDisplayDate = (d: Date): string =>
    format(d, 'yyyy년 M월 d일 (eee)', { locale: ko });

const batchProgress = (b: PlanBatchWithProgress) =>
    `${b.completed_sessions}/${b.batch_count}`;

const batchStatus = (b: PlanBatchWithProgress): 'pending' | 'in-progress' | 'done' | 'skipped' => {
    if (b.status === 'done' || b.status === 'skipped') return b.status;
    if (b.completed_sessions >= b.batch_count) return 'done';
    if (b.completed_sessions > 0) return 'in-progress';
    return 'pending';
};

// ── Sub-components ────────────────────────────────────────────────────────────

const ViewToggle = ({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) => (
    <div className="flex items-center gap-0.5 bg-surface rounded-lg p-0.5 shadow-(--shadow-inset)">
        {(['day', 'week', 'month'] as ViewMode[]).map((v) => {
            const label = v === 'day' ? '일' : v === 'week' ? '주' : '월';
            return (
                <button
                    key={v}
                    onClick={() => onChange(v)}
                    className={`text-[12px] font-medium px-3 py-1 rounded-md border-none cursor-pointer transition-colors duration-150 ${
                        view === v
                            ? 'bg-main-bg text-primary shadow-sm'
                            : 'bg-transparent text-muted hover:text-secondary'
                    }`}
                >
                    {label}
                </button>
            );
        })}
    </div>
);

const StatusBadge = ({ batch }: { batch: PlanBatchWithProgress }) => {
    const status = batchStatus(batch);
    const styles: Record<string, string> = {
        pending: 'bg-surface text-muted border border-border',
        'in-progress': 'bg-amber-50 text-amber-700 border border-amber-200',
        done: 'bg-green-50 text-green-700 border border-green-200',
        skipped: 'bg-surface text-muted border border-border line-through',
    };
    const labels: Record<string, string> = {
        pending: '대기',
        'in-progress': `진행중 ${batchProgress(batch)}`,
        done: '완료',
        skipped: '건너뜀',
    };
    return (
        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-md ${styles[status]}`}>
            {labels[status]}
        </span>
    );
};

const BatchCard = ({
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

    return (
        <div className="flex gap-2">
            <div className="flex flex-col gap-1 pt-1 shrink-0">
                <button
                    onClick={() => onMove('up')}
                    disabled={index === 0}
                    className="w-6 h-6 rounded-md flex items-center justify-center border-none bg-surface text-muted cursor-pointer shadow-(--shadow-inset) hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronUp size={13} strokeWidth={2} />
                </button>
                <button
                    onClick={() => onMove('down')}
                    disabled={index === total - 1}
                    className="w-6 h-6 rounded-md flex items-center justify-center border-none bg-surface text-muted cursor-pointer shadow-(--shadow-inset) hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronDown size={13} strokeWidth={2} />
                </button>
            </div>
            <div className="flex-1 border border-border rounded-xl p-4 bg-main-bg hover:border-border-strong transition-colors duration-150">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Package size={14} strokeWidth={1.5} color="var(--color-muted)" className="shrink-0 mt-[1px]" />
                        <span className="text-[14px] font-semibold text-primary">{batch.bean_name}</span>
                        <span className="text-[12px] text-muted">({batch.batch_type})</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge batch={batch} />
                        {canStart && (
                            <button
                                onClick={onStart}
                                className="flex items-center gap-1 text-[12px] font-medium text-white bg-primary px-2.5 py-1 rounded-lg border-none cursor-pointer hover:opacity-90 transition-opacity"
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
                        <span>목표 <span className="font-medium text-primary">{batch.target_roasted_kg} kg</span></span>
                        <span className="text-border-subtle">│</span>
                        <span>Batch <span className="font-medium text-primary">{batch.batch_size_kg} kg</span></span>
                        <span className="text-border-subtle">│</span>
                        <span className="font-medium text-primary">{batch.batch_count}회</span>
                        {batch.machine_id && (
                            <>
                                <span className="text-border-subtle">│</span>
                                <span>{batch.machine_id}</span>
                            </>
                        )}
                    </div>
                    {batch.notes && (
                        <div className="text-[12px] text-muted">{batch.notes}</div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ── Month View ────────────────────────────────────────────────────────────────

const MonthView = ({
    selectedDate,
    userId,
    onSelectDay,
}: {
    selectedDate: Date;
    userId: string;
    onSelectDay: (d: Date) => void;
}) => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const { data: summaries = [] } = useMonthSummary(userId, year, month);
    const summaryByDate = new Map(summaries.map((s) => [s.date, s]));

    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const numWeeks = days.length / 7;

    const dayHeaders = ['월', '화', '수', '목', '금', '토', '일'];

    return (
        <div className="flex-1 flex flex-col overflow-hidden border-t border-border-subtle">
            {/* Day-of-week header row */}
            <div className="grid grid-cols-7 border-b border-border-subtle shrink-0">
                {dayHeaders.map((d, i) => (
                    <div
                        key={d}
                        className={`
                            py-2 text-center text-[11px] font-medium text-muted
                            ${i < 6 ? 'border-r border-border-subtle' : ''}
                        `}
                    >
                        {d}
                    </div>
                ))}
            </div>

            {/* Calendar grid — fills remaining height */}
            <div
                className="flex-1 grid grid-cols-7 overflow-hidden"
                style={{ gridTemplateRows: `repeat(${numWeeks}, 1fr)` }}
            >
                {days.map((day, idx) => {
                    const key = toDateKey(day);
                    const summary = summaryByDate.get(key);
                    const isCurrentMonth = isSameMonth(day, selectedDate);
                    const isSelected = isSameDay(day, selectedDate);
                    const today = isToday(day);
                    const col = idx % 7;
                    const row = Math.floor(idx / 7);
                    const isLastRow = row === numWeeks - 1;
                    const isLastCol = col === 6;

                    const totalBatches = summary
                        ? summary.pending + summary.in_progress + summary.done + summary.skipped
                        : 0;

                    return (
                        <button
                            key={key}
                            onClick={() => onSelectDay(day)}
                            className={`
                                flex flex-col gap-1 p-2 border-none cursor-pointer text-left
                                transition-colors duration-100 overflow-hidden
                                ${isSelected ? 'bg-primary/5' : isCurrentMonth ? 'bg-main-bg hover:bg-surface' : 'bg-surface/40 hover:bg-surface'}
                                ${!isLastRow ? 'border-b border-border-subtle' : ''}
                                ${!isLastCol ? 'border-r border-border-subtle' : ''}
                            `}
                        >
                            {/* Date number — top right */}
                            <div className="flex justify-end">
                                <span className={`
                                    text-[12px] font-medium w-6 h-6 flex items-center justify-center rounded-full leading-none
                                    ${today ? 'bg-primary text-white' : isCurrentMonth ? 'text-primary' : 'text-muted/40'}
                                `}>
                                    {format(day, 'd')}
                                </span>
                            </div>

                            {/* Batch event pills — one per batch, bean name */}
                            {totalBatches > 0 && isCurrentMonth && summary && (
                                <div className="flex flex-col gap-0.5 w-full overflow-hidden">
                                    {summary.batches.slice(0, 4).map((b) => {
                                        const pillStyle =
                                            b.status === 'done'
                                                ? 'bg-green-50 text-green-700'
                                                : b.status === 'in-progress'
                                                  ? 'bg-amber-100 text-amber-700'
                                                  : b.status === 'skipped'
                                                    ? 'bg-surface text-muted/50 line-through'
                                                    : 'bg-surface text-secondary border border-border';
                                        const dotColor =
                                            b.status === 'done'
                                                ? 'bg-green-400'
                                                : b.status === 'in-progress'
                                                  ? 'bg-amber-400'
                                                  : 'bg-border-strong';
                                        return (
                                            <div
                                                key={b.id}
                                                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium w-full ${pillStyle}`}
                                            >
                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                                                <span className="truncate">{b.bean_name}</span>
                                            </div>
                                        );
                                    })}
                                    {summary.batches.length > 4 && (
                                        <div className="text-[10px] text-muted px-1.5">
                                            +{summary.batches.length - 4}개 더
                                        </div>
                                    )}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

// ── Week View ─────────────────────────────────────────────────────────────────

const WeekDayColumn = ({
    day,
    summary,
    isSelected,
    onSelect,
}: {
    day: Date;
    summary: DayPlanSummary | undefined;
    isSelected: boolean;
    onSelect: () => void;
}) => {
    const today = isToday(day);
    const totalBatches = summary
        ? summary.pending + summary.in_progress + summary.done + summary.skipped
        : 0;

    return (
        <div
            onClick={onSelect}
            className={`
                flex-1 flex flex-col border rounded-xl cursor-pointer transition-colors duration-100
                ${isSelected ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-border-strong bg-main-bg'}
            `}
        >
            {/* Day header */}
            <div className={`px-3 py-2.5 border-b ${isSelected ? 'border-primary/20' : 'border-border'}`}>
                <div className="flex items-center gap-1.5">
                    <span className={`
                        text-[11px] font-medium w-5 h-5 flex items-center justify-center rounded-full shrink-0
                        ${today ? 'bg-primary text-white' : 'text-muted'}
                    `}>
                        {format(day, 'd')}
                    </span>
                    <span className="text-[11px] text-muted">{format(day, 'eee', { locale: ko })}</span>
                </div>
            </div>
            {/* Batch event pills */}
            <div className="px-2 py-2 flex-1 flex flex-col gap-0.5 overflow-hidden">
                {totalBatches === 0 ? (
                    <span className="text-[10px] text-muted/40 select-none px-1">—</span>
                ) : summary?.batches.map((b) => {
                    const pillStyle =
                        b.status === 'done'
                            ? 'bg-green-50 text-green-700'
                            : b.status === 'in-progress'
                              ? 'bg-amber-100 text-amber-700'
                              : b.status === 'skipped'
                                ? 'bg-surface text-muted/50 line-through'
                                : 'bg-surface text-secondary border border-border';
                    const dotColor =
                        b.status === 'done'
                            ? 'bg-green-400'
                            : b.status === 'in-progress'
                              ? 'bg-amber-400'
                              : 'bg-border-strong';
                    return (
                        <div
                            key={b.id}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium w-full ${pillStyle}`}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                            <span className="truncate">{b.bean_name}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const WeekView = ({
    selectedDate,
    userId,
    onSelectDay,
}: {
    selectedDate: Date;
    userId: string;
    onSelectDay: (d: Date) => void;
}) => {
    const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
    const { data: summaries = [] } = useWeekSummary(userId, weekStart);
    const summaryByDate = new Map(summaries.map((s) => [s.date, s]));
    const days = eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 1 }) });

    return (
        <div className="flex-1 overflow-hidden px-6 py-4">
            <div className="flex gap-2 h-full">
                {days.map((day) => {
                    const key = toDateKey(day);
                    return (
                        <WeekDayColumn
                            key={key}
                            day={day}
                            summary={summaryByDate.get(key)}
                            isSelected={isSameDay(day, selectedDate)}
                            onSelect={() => onSelectDay(day)}
                        />
                    );
                })}
            </div>
        </div>
    );
};

// ── Day View ──────────────────────────────────────────────────────────────────

const DayView = ({
    selectedDate,
    userId,
    onStartBatch,
}: {
    selectedDate: Date;
    userId: string;
    onStartBatch: (handoff: PlanBatchHandoff) => void;
}) => {
    const dateKey = toDateKey(selectedDate);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingBatch, setEditingBatch] = useState<PlanBatchWithProgress | null>(null);

    const { data: dayPlan, isLoading: isDayPlanLoading } = useDayPlan(userId, dateKey);
    const planId = dayPlan?.id ?? '';

    const { data: batches = [], isLoading: isBatchesLoading } = usePlanBatches(planId);
    const isLoading = isDayPlanLoading || isBatchesLoading;

    const createBatch = useCreatePlanBatch(planId);
    const deleteBatch = useDeletePlanBatch(planId);
    const updateBatch = useUpdatePlanBatch(planId);
    const reorderBatches = useReorderPlanBatches(planId);

    const handleAddBatch = useCallback(
        (data: NewBatchData) => {
            if (!planId) return;
            createBatch.mutate(
                {
                    plan_id: planId,
                    order_index: batches.length,
                    bean_name: data.beanName || data.batchType,
                    bean_id: data.beanId,
                    roast_profile_id: data.profileId,
                    machine_id: data.machineId || null,
                    target_roasted_kg: data.targetRoasted,
                    batch_size_kg: data.batchSize,
                    yield_pct: data.yieldPct,
                    batch_type: data.batchType,
                    notes: data.notes,
                    green_lot: data.greenLot,
                    status: 'pending',
                },
                {
                    onError: (err) => {
                        console.error('[Schedule] createBatch failed:', err);
                        alert(`배치 추가 실패: ${err instanceof Error ? err.message : String(err)}`);
                    },
                },
            );
        },
        [planId, batches.length, createBatch],
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
        (batch: PlanBatchWithProgress) => {
            updateBatch.mutate({ id: batch.id, status: 'in-progress' });
            onStartBatch({
                planBatchId: batch.id,
                beanName: batch.bean_name,
                batchSizeKg: Number(batch.batch_size_kg),
                profileId: batch.roast_profile_id,
            });
        },
        [updateBatch, onStartBatch],
    );

    return (
        <>
            {/* Toolbar */}
            <div className="shrink-0 border-b border-border-subtle bg-main-bg px-8 py-2.5 flex items-center gap-2">
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    disabled={isDayPlanLoading}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-primary px-3 py-1.5 rounded-lg border border-border bg-surface shadow-(--shadow-inset) cursor-pointer hover:bg-surface-raised transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Plus size={13} strokeWidth={2} />
                    새 배치 추가
                </button>
            </div>
            {/* Batch list */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
                {isLoading ? (
                    <div className="text-[13px] text-muted text-center py-12">불러오는 중...</div>
                ) : batches.length === 0 ? (
                    <div className="border border-dashed border-border rounded-xl px-4 py-10 text-[13px] text-muted text-center select-none">
                        오늘의 배치가 없습니다. "+ 새 배치 추가"로 시작하세요.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {batches.map((batch, index) => (
                            <BatchCard
                                key={batch.id}
                                batch={batch}
                                index={index}
                                total={batches.length}
                                onMove={(dir) => handleMove(index, dir)}
                                onDelete={() => deleteBatch.mutate(batch.id)}
                                onStart={() => handleStart(batch)}
                                onEdit={() => setEditingBatch(batch)}
                            />
                        ))}
                    </div>
                )}
            </div>
            <AddBatchModal
                open={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onAdd={handleAddBatch}
            />
            <EditBatchModal
                key={editingBatch?.id ?? 'none'}
                open={editingBatch !== null}
                batch={editingBatch}
                currentDateKey={dateKey}
                onClose={() => setEditingBatch(null)}
                onSaved={() => setEditingBatch(null)}
            />
        </>
    );
};

// ── Main view ─────────────────────────────────────────────────────────────────

interface ScheduleProps {
    onStartBatch: (handoff: PlanBatchHandoff) => void;
}

export const Schedule = ({ onStartBatch }: ScheduleProps) => {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const [view, setView] = useState<ViewMode>('day');
    const [selectedDate, setSelectedDate] = useState(new Date());

    const handleSelectDay = useCallback((d: Date) => {
        setSelectedDate(d);
        setView('day');
    }, []);

    const handleNav = useCallback((dir: 1 | -1) => {
        setSelectedDate((prev) => {
            if (view === 'day') return addDays(prev, dir);
            if (view === 'week') return addWeeks(prev, dir);
            return addMonths(prev, dir);
        });
    }, [view]);

    const navLabel = (() => {
        if (view === 'day') return toFullDisplayDate(selectedDate);
        if (view === 'week') {
            const ws = startOfWeek(selectedDate, { weekStartsOn: 1 });
            const we = endOfWeek(selectedDate, { weekStartsOn: 1 });
            return `${format(ws, 'M/d')} – ${format(we, 'M/d')}`;
        }
        return format(selectedDate, 'yyyy년 M월', { locale: ko });
    })();

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Nav bar */}
            <div className="shrink-0 border-b border-border-subtle bg-main-bg px-6 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => handleNav(-1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border-none bg-surface text-muted cursor-pointer shadow-(--shadow-inset) hover:text-primary transition-colors"
                    >
                        <ChevronLeft size={14} strokeWidth={2} />
                    </button>
                    <span className="text-[13px] font-semibold text-primary min-w-[160px] text-center">
                        {navLabel}
                    </span>
                    <button
                        onClick={() => handleNav(1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border-none bg-surface text-muted cursor-pointer shadow-(--shadow-inset) hover:text-primary transition-colors"
                    >
                        <ChevronRight size={14} strokeWidth={2} />
                    </button>
                    {!isToday(selectedDate) && (
                        <button
                            onClick={() => setSelectedDate(new Date())}
                            className="text-[11px] font-medium text-muted border border-border rounded-md px-2 py-0.5 bg-surface shadow-(--shadow-inset) cursor-pointer hover:text-primary transition-colors"
                        >
                            오늘
                        </button>
                    )}
                </div>
                <ViewToggle view={view} onChange={setView} />
            </div>

            {/* Content */}
            {view === 'day' && (
                <DayView
                    selectedDate={selectedDate}
                    userId={userId}
                    onStartBatch={onStartBatch}
                />
            )}
            {view === 'week' && (
                <WeekView
                    selectedDate={selectedDate}
                    userId={userId}
                    onSelectDay={handleSelectDay}
                />
            )}
            {view === 'month' && (
                <MonthView
                    selectedDate={selectedDate}
                    userId={userId}
                    onSelectDay={handleSelectDay}
                />
            )}
        </div>
    );
};
