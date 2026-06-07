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
import { AddBatchModal, type NewBatchData } from '@widgets/add-batch-modal';
import { RecurringEditScopeModal, type EditScope } from '@widgets/recurring-edit-scope-modal';
import {
    useDayPlan,
    useDayBatches,
    useCreatePlanBatch,
    useReorderPlanBatches,
    useCreateRecurringBatches,
    useMonthSummary,
    useWeekSummary,
    useDeleteSingleBatch,
    useDeleteFromThis,
    useDeleteAllBatches,
    useUpdateSingleBatch,
    useUpdateFromThis,
    useUpdateAllBatches,
    dayPlanApi,
    planBatchApi,
} from '@entities/plan';
import type { DateSummary } from '@entities/plan';
import type { PlanBatchWithProgress, PlanBatchHandoff, PlanBatchInsert } from '@shared/types/database.types';
import { buildRRule } from '@shared/lib/rrule';

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

// Map RecurrenceInterval to human-readable label
const getRecurrenceLabel = (rrule: string | null): string => {
    if (!rrule) return '';
    if (rrule.includes('FREQ=DAILY')) return '매일';
    if (rrule.includes('FREQ=WEEKLY')) {
        if (rrule.includes('INTERVAL=2')) return '격주';
        return '매주';
    }
    if (rrule.includes('FREQ=MONTHLY')) return '매월';
    return '반복';
};

// ── Sub-components ────────────────────────────────────────────────────────────

const ViewToggle = ({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) => (
    <div className="flex items-center gap-0.5 bg-surface rounded-lg p-0.5">
        {(['day', 'week', 'month'] as ViewMode[]).map((v) => {
            const label = v === 'day' ? '일' : v === 'week' ? '주' : '월';
            return (
                <button
                    key={v}
                    onClick={() => onChange(v)}
                    className={`text-[12px] font-medium px-3 py-1 rounded-md border-none cursor-pointer transition-colors duration-150 ${
                        view === v
                            ? 'bg-main-bg text-primary'
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
        pending: 'bg-surface text-muted',
        'in-progress': 'bg-amber-50 text-amber-700 border border-amber-200',
        done: 'bg-green-50 text-green-700 border border-green-200',
        skipped: 'bg-surface text-muted line-through',
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
    const isRecurring = !!batch.recurrence_rule_id;

    return (
        <div className="flex gap-2">
            <div className="flex flex-col gap-1 pt-1 shrink-0">
                <button
                    onClick={() => onMove('up')}
                    disabled={index === 0}
                    className="w-6 h-6 rounded-md flex items-center justify-center border-none bg-surface text-muted cursor-pointer  hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronUp size={13} strokeWidth={2} />
                </button>
                <button
                    onClick={() => onMove('down')}
                    disabled={index === total - 1}
                    className="w-6 h-6 rounded-md flex items-center justify-center border-none bg-surface text-muted cursor-pointer  hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                                {getRecurrenceLabel(batch.rrule)}
                            </span>
                        )}
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

// ── Batch count dots (week/month) ─────────────────────────────────────────────

const BatchCountDots = ({ count, compact = false }: { count: number; compact?: boolean }) => {
    if (count === 0) return null;

    const dotCount = Math.min(count, 4);
    const overflow = count - 4;

    return (
        <div className="flex flex-col gap-0.5 w-full overflow-hidden">
            <div className="flex items-center gap-0.5 flex-wrap">
                {Array.from({ length: dotCount }, (_, i) => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-primary/50 shrink-0" />
                ))}
            </div>
            {overflow > 0 && (
                <div className="text-[10px] text-muted px-0.5">
                    {compact ? `+${overflow}` : `+${overflow}개 더`}
                </div>
            )}
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
        <div className="flex-1 flex flex-col overflow-hidden">
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

                    const batchCount = summary?.count ?? 0;

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

                            {batchCount > 0 && isCurrentMonth && (
                                <BatchCountDots count={batchCount} />
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
    summary: DateSummary | undefined;
    isSelected: boolean;
    onSelect: () => void;
}) => {
    const today = isToday(day);
    const batchCount = summary?.count ?? 0;

    return (
        <div
            onClick={onSelect}
            className={`
                flex-1 flex flex-col rounded-xl cursor-pointer transition-colors duration-100
                ${isSelected ? 'bg-primary/5' : 'bg-main-bg'}
            `}
        >
            {/* Day header */}
            <div className="px-3 py-2.5">
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
            <div className="px-2 py-2 flex-1 flex flex-col gap-0.5 overflow-hidden">
                {batchCount === 0 ? (
                    <span className="text-[10px] text-muted/40 select-none px-1">—</span>
                ) : (
                    <BatchCountDots count={batchCount} compact />
                )}
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
    const [editScope, setEditScope] = useState<EditScope | null>(null);
    const [scopeBatch, setScopeBatch] = useState<PlanBatchWithProgress | null>(null);
    const [isScopeModalOpen, setIsScopeModalOpen] = useState(false);

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
                if (window.confirm(`이 배치만 삭제하시겠습니까?`)) {
                    let planId = batch.plan_id;
                    if (!planId && batch.recurrence_rule_id && batch.scheduled_date) {
                        const plan = await dayPlanApi.getOrCreate(userId, batch.scheduled_date);
                        planId = plan.id;
                    }
                    deleteSingleBatch.mutate({
                        id: batch.id,
                        meta: {
                            recurrenceRuleId: batch.recurrence_rule_id,
                            originalDate: batch.scheduled_date ?? dateKey,
                            planId: planId ?? '',
                        },
                    });
                }
            } else if (scope === 'from_this') {
                if (window.confirm(`${format(selectedDate, 'M월 d일')} 이후 모든 반복 배치를 삭제하시겠습니까?`)) {
                    deleteFromThis.mutate({
                        ruleId: batch.recurrence_rule_id,
                        fromDate: dateKey,
                    });
                }
            } else if (scope === 'all') {
                if (window.confirm('전체 반복 일정을 삭제하시겠습니까? 과거 기록은 유지됩니다.')) {
                    deleteAllBatches.mutate(batch.recurrence_rule_id);
                }
            }

            setIsScopeModalOpen(false);
            setScopeBatch(null);
        },
        [deleteSingleBatch, deleteFromThis, deleteAllBatches, dateKey, selectedDate, userId],
    );

    // ── Edit handler ─────────────────────────────────────────────────────────

    const handleEdit = useCallback(
        (batch: PlanBatchWithProgress) => {
            if (batch.recurrence_rule_id) {
                // Recurring batch → show scope modal first
                setScopeBatch(batch);
                setIsScopeModalOpen(true);
            } else {
                // One-off batch → open edit form directly
                setEditingBatch(batch);
                setEditScope(null);
            }
        },
        [],
    );

    // ── Delete from BatchCard ────────────────────────────────────────────────

    const handleBatchDelete = useCallback(
        (batch: PlanBatchWithProgress) => {
            if (batch.recurrence_rule_id) {
                // Show scope modal for recurring batch delete
                setScopeBatch(batch);
                setIsScopeModalOpen(true);
            } else {
                if (window.confirm(`"${batch.bean_name}" 배치를 삭제하시겠습니까?`)) {
                    deleteSingleBatch.mutate({ id: batch.id });
                }
            }
        },
        [deleteSingleBatch],
    );

    // ── Scope modal confirm → then show AddBatchModal or handle delete ───────

    const handleScopeConfirm = useCallback(
        (scope: EditScope, action: 'edit' | 'delete') => {
            if (!scopeBatch) return;

            if (action === 'delete') {
                handleScopeDelete(scope, scopeBatch);
            } else {
                // action === 'edit' → open AddBatchModal with scope
                setEditScope(scope);
                setEditingBatch(scopeBatch);
                setIsScopeModalOpen(false);
                setScopeBatch(null);
            }
        },
        [scopeBatch, handleScopeDelete],
    );

    // ── Add / Save handler ──────────────────────────────────────────────────

    const handleAddBatch = useCallback(
        async (data: NewBatchData) => {
            if (editScope && editingBatch?.recurrence_rule_id) {
                // Scope-based edit for recurring batch
                const basePatch = {
                    id: editingBatch.id,
                    plan_id: '',
                    bean_name: data.beanName || editingBatch.bean_name,
                    bean_id: data.beanId,
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
                    let planId = editingBatch.plan_id;
                    if (!planId && editingBatch.recurrence_rule_id) {
                        const scheduleDate = editingBatch.scheduled_date ?? dateKey;
                        const plan = await dayPlanApi.getOrCreate(userId, scheduleDate);
                        planId = plan.id;
                    }
                    updateSingleBatch.mutate({
                        id: editingBatch.id,
                        patch: { ...basePatch, plan_id: planId ?? '' },
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
                        bean_name: data.beanName || editingBatch.bean_name,
                        green_lot: data.greenLot,
                        batch_size_kg: data.batchSize,
                        yield_pct: data.yieldPct / 100,
                        target_roasted_kg: data.targetRoasted,
                        notes: data.notes,
                        batch_type: data.batchType,
                        ...(data.recurringInterval
                            ? { rrule: buildRRule(data.recurringInterval) }
                            : {}),
                    };

                    if (editScope === 'from_this') {
                        updateFromThis.mutate({
                            ruleId: editingBatch.recurrence_rule_id,
                            fromDate: instanceDate,
                            patch: {
                                ...masterPatch,
                                dtstart: instanceDate,
                                userId,
                            },
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

            // Standard flow: one-off or recurring creation
            const baseBatch: Omit<PlanBatchInsert, 'plan_id'> = {
                order_index: batches.length,
                bean_name: data.beanName || data.batchType,
                bean_id: data.beanId,
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
                // Create recurring batches across multiple dates
                createRecurringBatches.mutate(
                    {
                        baseBatch,
                        interval: data.recurringInterval,
                        dtstart: data.date,
                    },
                    {
                        onError: (err) => {
                            console.error('[Schedule] createRecurringBatches failed:', err);
                            alert(`반복 배치 추가 실패: ${err instanceof Error ? err.message : String(err)}`);
                        },
                    },
                );
            } else if (planId) {
                // Single batch creation
                createBatch.mutate(
                    { ...baseBatch, plan_id: planId } as PlanBatchInsert,
                    {
                        onError: (err) => {
                            console.error('[Schedule] createBatch failed:', err);
                            alert(`배치 추가 실패: ${err instanceof Error ? err.message : String(err)}`);
                        },
                    },
                );
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

            // Virtual recurring batch (plan_id is null) → materialize first
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
                beanName: batch.bean_name,
                batchSizeKg: Number(batch.batch_size_kg),
                profileId: batch.roast_profile_id,
                batchCount: batch.batch_count,
                completedSessions: batch.completed_sessions,
            });
        },
        [updateSingleBatch, onStartBatch, userId],
    );

    return (
        <>
            {/* Toolbar */}
            <div className="shrink-0 border-b border-border-subtle bg-main-bg px-8 py-2.5 flex items-center gap-2">
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    disabled={isDayPlanLoading}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-primary px-3 py-1.5 rounded-lg bg-surface cursor-pointer hover:bg-surface-raised transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                    <div className="bg-main-bg rounded-xl px-4 py-12 flex flex-col items-center justify-center gap-4 select-none">
                        <div className="text-[13px] text-muted text-center leading-relaxed">
                            오늘의 배치가 없습니다.<br />
                            새 배치를 추가하여 일정을 시작하세요.
                        </div>
                        <button
                            onClick={() => setIsAddModalOpen(true)}
                            className="flex items-center gap-1.5 text-[13px] font-medium text-primary px-4 py-2 rounded-lg bg-surface cursor-pointer hover:bg-surface-raised transition-colors"
                        >
                            <Plus size={14} strokeWidth={2} />
                            새 배치 추가
                        </button>
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
                                onDelete={() => handleBatchDelete(batch)}
                                onStart={() => handleStart(batch)}
                                onEdit={() => handleEdit(batch)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Scope modal for recurring batches */}
            {scopeBatch && (
                <RecurringEditScopeModal
                    open={isScopeModalOpen}
                    onClose={() => { setIsScopeModalOpen(false); setScopeBatch(null); setEditScope(null); }}
                    onConfirm={handleScopeConfirm}
                    batchLabel={`${scopeBatch.bean_name} / ${scopeBatch.batch_size_kg}kg`}
                    recurrenceLabel={getRecurrenceLabel(scopeBatch.rrule)}
                    isFirstInstance={batchStatus(scopeBatch) === 'pending' && batches.indexOf(scopeBatch) === 0}
                />
            )}

            <AddBatchModal
                key={String(isAddModalOpen) + (editingBatch?.id ?? '') + (editScope ?? '')}
                open={isAddModalOpen || (editingBatch !== null && editScope !== null)}
                onClose={() => { setIsAddModalOpen(false); setEditingBatch(null); setEditScope(null); }}
                onAdd={handleAddBatch}
                editingBatch={editingBatch}
                editScope={editScope}
                currentDateKey={dateKey}
                onSaved={() => { setEditingBatch(null); setEditScope(null); }}
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
                        className="w-7 h-7 rounded-lg flex items-center justify-center border-none bg-surface text-muted cursor-pointer  hover:text-primary transition-colors"
                    >
                        <ChevronLeft size={14} strokeWidth={2} />
                    </button>
                    <span className="text-[13px] font-semibold text-primary min-w-[160px] text-center">
                        {navLabel}
                    </span>
                    <button
                        onClick={() => handleNav(1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border-none bg-surface text-muted cursor-pointer  hover:text-primary transition-colors"
                    >
                        <ChevronRight size={14} strokeWidth={2} />
                    </button>
                    {!isToday(selectedDate) && (
                        <button
                            onClick={() => setSelectedDate(new Date())}
                            className="text-[11px] font-medium text-muted rounded-md px-2 py-0.5 bg-surface cursor-pointer hover:text-primary transition-colors"
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