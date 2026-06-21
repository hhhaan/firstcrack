import { useBeans } from '@entities/bean/queries';
import { beanStockEventApi, useBeanStockSummaries, useBeanStockSummary } from '@entities/bean-stock-event';
import { type BlendWithComponents, useBlends } from '@entities/blend';
import { type Machine, useMachines } from '@entities/machine';
import { dayPlanApi, planBatchApi, planKeys } from '@entities/plan';
import type { RoastProfileWithSource } from '@entities/roast-profile';
import { useRoastProfiles } from '@entities/roast-profile/queries';
import { getDateFnsLocale } from '@shared/i18n';
import { isRecurringHorizonStockShort, recurringHorizonGreenNeededGrams } from '@shared/lib/batch-stock';
import { cn } from '@shared/lib/cn';
import type { RecurrenceInterval } from '@shared/lib/rrule';
import { useAuthStore } from '@shared/store/auth';
import type { Bean, PlanBatchWithProgress, RoastProfile } from '@shared/types/database.types';
import { CounterInput } from '@shared/ui/CounterInput';
import { Calendar } from '@shared/ui/calendar/Calendar';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertTriangle, CalendarIcon, Cpu, Package, Repeat, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchableSelect } from './SearchableSelect';

/**
 * Parse an RRULE string back to a RecurrenceInterval label.
 * Used to pre-populate the recurrence selection when editing an existing batch.
 */
function parseRruleToInterval(rrule: string | null): RecurrenceInterval | null {
    if (!rrule) return null;
    if (rrule.includes('FREQ=DAILY')) return 'daily';
    if (rrule.includes('FREQ=WEEKLY') && rrule.includes('INTERVAL=2')) return 'biweekly';
    if (rrule.includes('FREQ=WEEKLY')) return 'weekly';
    if (rrule.includes('FREQ=MONTHLY')) return 'monthly';
    return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type BatchType = 'Single Origin' | 'Pre-roast Blend' | 'Post-roast Blend';

const RECURRENCE_OPTIONS: { value: RecurrenceInterval }[] = [
    { value: 'daily' },
    { value: 'weekly' },
    { value: 'biweekly' },
    { value: 'monthly' },
];

export interface NewBatchData {
    date: Date;
    machineId: string;
    machineName: string;
    batchType: BatchType;
    profileId: string | null;
    profileName: string;
    beanId: string | null;
    blendId: string | null;
    beanName: string;
    targetRoasted: number;
    batchSize: number;
    yieldPct: number;
    batchCount: number;
    greenNeeded: number;
    greenLot: string;
    notes: string;
    recurringInterval?: RecurrenceInterval | null;
}

/** Edit scope for recurring batch operations */
export type EditScope = 'single' | 'from_this' | 'all';

interface AddBatchModalProps {
    open: boolean;
    onClose: () => void;
    onAdd?: (data: NewBatchData) => void;
    editingBatch?: PlanBatchWithProgress | null;
    editScope?: EditScope | null;
    currentDateKey?: string;
    onSaved?: () => void;
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const inputCls =
    'w-full px-3.5 py-2.5 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all focus:border-black/20 dark:focus:border-[#585d61]';
const labelCls = 'flex items-center gap-1.5 text-[11px] font-semibold text-muted mb-1.5 tracking-[0.04em] uppercase';
const tabCls = (active: boolean) =>
    `flex-1 py-2 rounded-xl border-none text-[13px] cursor-pointer transition-all duration-200 ${
        active
            ? 'bg-white dark:bg-surface-elevated font-semibold text-primary dark:text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)]'
            : 'bg-transparent font-medium text-muted dark:text-white hover:text-secondary dark:hover:text-white/70'
    }`;

const DEFAULT_YIELD = 82;
const DEFAULT_BATCH_SIZE = 25;

// ── Helpers ───────────────────────────────────────────────────────────────────

const todayDate = () => new Date();

// ── Main component ────────────────────────────────────────────────────────────

export const AddBatchModal = ({
    open,
    onClose,
    onAdd,
    editingBatch,
    editScope,
    currentDateKey,
    onSaved,
}: AddBatchModalProps) => {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const qc = useQueryClient();
    const { t } = useTranslation();

    const { data: beans = [] } = useBeans(userId);
    const { data: stockSummaries = {} } = useBeanStockSummaries(userId);
    const { machines } = useMachines();
    const { data: profiles = [] } = useRoastProfiles(userId);
    const { data: blends = [] } = useBlends(userId);

    const isEdit = !!editingBatch;
    const isDateDisabled = editScope === 'all';
    const isRruleVisible = !isEdit || editScope === 'from_this' || editScope === 'all';

    const [saving, setSaving] = useState(false);
    const [date, setDate] = useState<Date | undefined>(
        editingBatch && currentDateKey ? new Date(currentDateKey + 'T00:00:00') : todayDate(),
    );
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [recurringInterval, setRecurringInterval] = useState<RecurrenceInterval | null>(null);

    useEffect(() => {
        if (!open) return;
        // Reset form fields when modal opens
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on open
        setRecurringInterval(editingBatch?.rrule ? parseRruleToInterval(editingBatch.rrule) : null);
    }, [open, editingBatch?.rrule]);
    const [machineId, setMachineId] = useState(() => editingBatch?.machine_id ?? machines[0]?.id ?? '');
    const [batchType, setBatchType] = useState<BatchType>(
        () => (editingBatch?.batch_type as BatchType) || 'Single Origin',
    );
    const [profileId, setProfileId] = useState(() => editingBatch?.roast_profile_id ?? '');
    const [beanId, setBeanId] = useState(() => editingBatch?.bean_id ?? '');
    const [blendId, setBlendId] = useState<string | null>(() => editingBatch?.blend_id ?? null);
    const [targetRoasted, setTargetRoasted] = useState(() =>
        editingBatch ? String(editingBatch.target_roasted_kg) : '',
    );
    const [batchSize, setBatchSize] = useState(() =>
        editingBatch ? String(editingBatch.batch_size_kg) : String(DEFAULT_BATCH_SIZE),
    );
    const [yieldPct, setYieldPct] = useState(() =>
        editingBatch ? String(Math.round((editingBatch.yield_pct ?? 0.82) * 100)) : String(DEFAULT_YIELD),
    );
    const [notes, setNotes] = useState(() => editingBatch?.notes ?? '');

    useEffect(() => {
        if (!open) return;
        const fn = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', fn);
        return () => window.removeEventListener('keydown', fn);
    }, [open, onClose]);

    // Derived calculations
    const targetNum = parseFloat(targetRoasted) || 0;
    const batchSizeNum = parseFloat(batchSize) || DEFAULT_BATCH_SIZE;
    const yieldNum = parseFloat(yieldPct) || DEFAULT_YIELD;
    const batchCount = targetNum > 0 ? Math.ceil(targetNum / batchSizeNum) : 0;
    const greenNeeded = targetNum > 0 && yieldNum > 0 ? Math.round((targetNum / (yieldNum / 100)) * 10) / 10 : 0;

    const selectedBean = beans.find((b) => b.id === beanId) as Bean | undefined;
    const selectedProfile = profiles.find((p) => p.id === profileId) as RoastProfile | undefined;
    const selectedMachine = machines.find((m) => m.id === machineId);
    const selectedBlend = blends.find((b) => b.id === blendId);

    const selectedBeanId = batchType === 'Single Origin' ? beanId : null;
    const { data: stockSummary } = useBeanStockSummary(selectedBeanId ?? '');
    const effectiveStockKg = (stockSummary?.effectiveGrams ?? 0) / 1000;
    const stockSufficient = greenNeeded === 0 || effectiveStockKg >= greenNeeded;
    const stockPct = greenNeeded > 0 ? Math.min(100, (effectiveStockKg / greenNeeded) * 100) : 100;

    const plannedGrams = batchSizeNum * batchCount * 1000;
    const isShortage = !!stockSummary && plannedGrams > 0 && stockSummary.effectiveGrams < plannedGrams;

    // ── Blend component stock checks ────────────────────────────────────────
    const isBlendType = batchType === 'Pre-roast Blend' || batchType === 'Post-roast Blend';
    const blendComponents = useMemo(() => {
        if (!isBlendType || !selectedBlend) return [];
        return (selectedBlend as BlendWithComponents).blend_components ?? [];
    }, [isBlendType, selectedBlend]);

    const blendStockQueries = useQueries({
        queries: blendComponents.map((comp) => ({
            queryKey: ['bean-stock-summary', comp.bean_id],
            queryFn: () => beanStockEventApi.getStockSummary(comp.bean_id),
            enabled: !!comp.bean_id,
        })),
    });

    const blendShortages = useMemo(() => {
        if (blendComponents.length === 0 || plannedGrams === 0) return [];
        return blendComponents.map((comp, i) => {
            const neededGrams = Math.round((Number(comp.ratio_pct) / 100) * plannedGrams);
            const summary = blendStockQueries[i]?.data;
            return {
                beanName: (comp as { beans?: { name: string } }).beans?.name ?? t('addBatchModal.unknown'),
                ratioPct: comp.ratio_pct,
                neededGrams,
                effectiveGrams: summary?.effectiveGrams ?? 0,
                isShort: summary ? summary.effectiveGrams < neededGrams : false,
            };
        });
    }, [blendComponents, plannedGrams, blendStockQueries, t]);

    const recurringHorizonShort = useMemo(() => {
        if (!recurringInterval || batchType !== 'Single Origin' || !beanId || !date) return null;
        const neededGrams = recurringHorizonGreenNeededGrams(recurringInterval, date, batchSizeNum, batchCount);
        if (neededGrams <= 0) return null;
        const effectiveGrams = stockSummary?.effectiveGrams ?? 0;
        if (!isRecurringHorizonStockShort(effectiveGrams, recurringInterval, date, batchSizeNum, batchCount)) {
            return null;
        }
        return {
            neededKg: (neededGrams / 1000).toFixed(1),
            availableKg: (effectiveGrams / 1000).toFixed(1),
        };
    }, [recurringInterval, batchType, beanId, date, batchSizeNum, batchCount, stockSummary?.effectiveGrams]);

    // 프로파일 선택 시 default_bean_id / default_blend_id 자동 pre-fill
    const handleProfileSelect = (id: string) => {
        setProfileId(id);
        if (!id) return;
        const selected = profiles.find((p) => p.id === id) as RoastProfileWithSource | undefined;
        if (selected?.default_bean_id) {
            setBatchType('Single Origin');
            setBeanId(selected.default_bean_id);
        } else if (selected?.default_blend_id) {
            setBatchType('Pre-roast Blend');
            setBlendId(selected.default_blend_id);
        }
    };

    const newDateKey = date ? format(date, 'yyyy-MM-dd') : '';
    const dateChanged = isEdit && currentDateKey && newDateKey !== currentDateKey;

    const canSubmit = date !== undefined && !!machineId && targetNum > 0 && batchSizeNum > 0 && !saving;

    const handleSubmit = async () => {
        if (!canSubmit || !date) return;

        if (isEdit && editingBatch) {
            setSaving(true);
            const oldPlanId = editingBatch.plan_id;
            const isBlendTypeEdit = batchType === 'Pre-roast Blend' || batchType === 'Post-roast Blend';
            let targetPlanId = editingBatch.plan_id;

            // ── Optimistic cache update ─────────────────────────────────
            const buildOptimisticBatch = (planId: string): PlanBatchWithProgress => ({
                ...editingBatch,
                plan_id: planId,
                machine_id: machineId || null,
                batch_type: batchType,
                roast_profile_id: profileId || null,
                bean_id: isBlendTypeEdit ? null : beanId || null,
                blend_id: isBlendTypeEdit ? blendId || null : null,
                bean_name: isBlendTypeEdit
                    ? (selectedBlend?.name ?? editingBatch.bean_name)
                    : (selectedBean?.name ?? editingBatch.bean_name),
                target_roasted_kg: targetNum,
                batch_size_kg: batchSizeNum,
                yield_pct: yieldNum / 100,
                green_lot: selectedBean
                    ? `${selectedBean.name} (${effectiveStockKg.toFixed(0)}kg)`
                    : editingBatch.green_lot,
                notes,
                updated_at: new Date().toISOString(),
            });

            // Save snapshot for rollback
            const snapshot: {
                oldPlan?: PlanBatchWithProgress[];
                oldDay?: PlanBatchWithProgress[];
                newPlan?: PlanBatchWithProgress[];
                newDay?: PlanBatchWithProgress[];
            } = {};

            const oldPlanKey = planKeys.batches(oldPlanId);
            snapshot.oldPlan = qc.getQueryData<PlanBatchWithProgress[]>(oldPlanKey);

            if (currentDateKey) {
                const oldDayKey = planKeys.dayBatches(userId, currentDateKey);
                snapshot.oldDay = qc.getQueryData<PlanBatchWithProgress[]>(oldDayKey);
            }

            // Patch old caches (remove if date changed, else update in-place)
            if (snapshot.oldPlan) {
                qc.setQueryData(
                    oldPlanKey,
                    dateChanged
                        ? snapshot.oldPlan.filter((b) => b.id !== editingBatch.id)
                        : snapshot.oldPlan.map((b) => (b.id === editingBatch.id ? buildOptimisticBatch(oldPlanId) : b)),
                );
            }
            if (snapshot.oldDay) {
                qc.setQueryData(
                    planKeys.dayBatches(userId, currentDateKey!),
                    dateChanged
                        ? snapshot.oldDay!.filter((b) => b.id !== editingBatch.id)
                        : snapshot.oldDay!.map((b) => (b.id === editingBatch.id ? buildOptimisticBatch(oldPlanId) : b)),
                );
            }

            try {
                // If date changed, create target plan and move
                if (dateChanged && newDateKey) {
                    const newPlan = await dayPlanApi.getOrCreate(userId, newDateKey);
                    targetPlanId = newPlan.id;

                    // Save new-plan cache snapshot before optimistic add
                    const newPlanKey = planKeys.batches(targetPlanId);
                    snapshot.newPlan = qc.getQueryData<PlanBatchWithProgress[]>(newPlanKey);
                    if (snapshot.newPlan) {
                        qc.setQueryData(newPlanKey, [...snapshot.newPlan, buildOptimisticBatch(targetPlanId)]);
                    }
                    const newDayKey = planKeys.dayBatches(userId, newDateKey);
                    snapshot.newDay = qc.getQueryData<PlanBatchWithProgress[]>(newDayKey);
                    if (snapshot.newDay) {
                        qc.setQueryData(newDayKey, [...snapshot.newDay, buildOptimisticBatch(targetPlanId)]);
                    }

                    await planBatchApi.move(editingBatch.id, targetPlanId);
                }

                await planBatchApi.updateSingle(editingBatch.id, {
                    id: editingBatch.id,
                    plan_id: targetPlanId,
                    machine_id: machineId || null,
                    batch_type: batchType,
                    roast_profile_id: profileId || null,
                    bean_id: isBlendTypeEdit ? null : beanId || null,
                    blend_id: isBlendTypeEdit ? blendId || null : null,
                    bean_name: isBlendTypeEdit
                        ? (selectedBlend?.name ?? editingBatch.bean_name)
                        : (selectedBean?.name ?? editingBatch.bean_name),
                    target_roasted_kg: targetNum,
                    batch_size_kg: batchSizeNum,
                    yield_pct: yieldNum / 100,
                    green_lot: selectedBean
                        ? `${selectedBean.name} (${effectiveStockKg.toFixed(0)}kg)`
                        : editingBatch.green_lot,
                    notes,
                });

                // Invalidate to ensure consistency
                qc.invalidateQueries({ queryKey: planKeys.batches(oldPlanId) });
                if (currentDateKey) {
                    qc.invalidateQueries({ queryKey: planKeys.dayBatches(userId, currentDateKey) });
                }
                if (dateChanged) {
                    qc.invalidateQueries({ queryKey: planKeys.batches(targetPlanId) });
                    qc.invalidateQueries({ queryKey: ['day_plan_range', userId] });
                    if (newDateKey) {
                        qc.invalidateQueries({ queryKey: planKeys.dayBatches(userId, newDateKey) });
                    }
                } else {
                    qc.invalidateQueries({ queryKey: ['day_batches'] });
                }

                onSaved?.();
                onClose();
            } catch (err) {
                // Rollback optimistic updates
                if (snapshot.oldPlan) qc.setQueryData(oldPlanKey, snapshot.oldPlan);
                if (snapshot.oldDay && currentDateKey) {
                    qc.setQueryData(planKeys.dayBatches(userId, currentDateKey), snapshot.oldDay);
                }
                if (snapshot.newPlan && targetPlanId !== oldPlanId) {
                    qc.setQueryData(planKeys.batches(targetPlanId), snapshot.newPlan);
                }
                if (snapshot.newDay && newDateKey) {
                    qc.setQueryData(planKeys.dayBatches(userId, newDateKey), snapshot.newDay);
                }

                console.error('[AddBatchModal] save failed:', err);
                alert(t('addBatchModal.saveFailed') + ` ${err instanceof Error ? err.message : String(err)}`);
            } finally {
                setSaving(false);
            }
        } else {
            const isBlendTypeAdd = batchType === 'Pre-roast Blend' || batchType === 'Post-roast Blend';
            onAdd?.({
                date,
                machineId,
                machineName: selectedMachine?.name ?? selectedMachine?.displayName ?? machineId,
                batchType,
                profileId: profileId || null,
                profileName: selectedProfile?.name ?? '',
                beanId: isBlendTypeAdd ? null : beanId || null,
                blendId: isBlendTypeAdd ? blendId || null : null,
                beanName: isBlendTypeAdd ? (selectedBlend?.name ?? '') : (selectedBean?.name ?? ''),
                targetRoasted: targetNum,
                batchSize: batchSizeNum,
                yieldPct: yieldNum,
                batchCount,
                greenNeeded,
                greenLot: selectedBean ? `${selectedBean.name} (${effectiveStockKg.toFixed(0)}kg)` : '',
                notes,
                recurringInterval: recurringInterval ?? undefined,
            });
            onClose();
        }
    };

    if (!open) return null;

    // Bean items for searchable select
    const beanItems = beans.map((b) => ({ ...b }));
    const profileItems = profiles.map((p) => ({ ...p }));

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="add-batch-modal-title"
            contentClassName="max-w-[600px] w-full max-h-[min(840px,calc(100vh-64px))] flex flex-col rounded-[16px] bg-[rgba(255,255,255,0.97)] dark:bg-[#181d21] dark:[&_*]:!text-white backdrop-[blur(20px)_saturate(180%)] shadow-[0_32px_80px_rgba(22,18,12,0.22)] border border-white dark:border-[#585d61] overflow-hidden"
        >
            {/* Header */}
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm border-b border-black/4 dark:border-[#585d61] px-8 pt-6 pb-5 flex items-center justify-between">
                <div>
                    <h2
                        id="add-batch-modal-title"
                        className="font-(--font-display) text-[22px] text-primary tracking-[-0.02em] m-0"
                    >
                        {isEdit ? t('addBatchModal.editBatch') : t('addBatchModal.addBatch')}
                    </h2>
                    {isEdit && editingBatch && (
                        <p className="text-[12px] text-muted mt-0.5 m-0">{editingBatch.bean_name}</p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="w-9 h-9 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all hover:text-primary"
                >
                    <X size={17} strokeWidth={2.5} />
                </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6">
                {/* Row 1 — 날짜 + 머신 */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>
                            <CalendarIcon size={12} /> {t('addBatchModal.date')}
                        </label>
                        <Popover
                            open={calendarOpen}
                            onOpenChange={(open) => {
                                if (!isDateDisabled) setCalendarOpen(open);
                            }}
                        >
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    disabled={isDateDisabled}
                                    className={cn(
                                        inputCls,
                                        'flex items-center gap-2 text-left',
                                        !isDateDisabled && 'cursor-pointer',
                                        isDateDisabled && 'opacity-60 cursor-not-allowed',
                                        !date && 'text-muted',
                                    )}
                                >
                                    <CalendarIcon size={13} className="text-muted shrink-0" />
                                    <span>
                                        {date
                                            ? format(date, 'M월 d일 (eee)', { locale: getDateFnsLocale() })
                                            : t('addBatchModal.date')}
                                    </span>
                                    {dateChanged && (
                                        <span className="ml-auto text-[10px] text-amber-600 font-semibold shrink-0">
                                            이동
                                        </span>
                                    )}
                                </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <Calendar
                                    mode="single"
                                    selected={date}
                                    onSelect={(d) => {
                                        setDate(d);
                                        setCalendarOpen(false);
                                    }}
                                    locale={getDateFnsLocale()}
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div>
                        <label className={labelCls}>
                            <Cpu size={12} /> {t('addBatchModal.machine')}
                        </label>
                        <SearchableSelect
                            placeholder={t('addBatchModal.machine')}
                            items={machines}
                            selectedId={machineId}
                            onSelect={setMachineId}
                            renderLabel={(item) => {
                                const m = item as Machine;
                                return m.name || m.displayName;
                            }}
                            renderOption={(item) => {
                                const m = item as Machine;
                                return (
                                    <div>
                                        <div className="text-primary font-medium">{m.name || m.displayName}</div>
                                        <div className="text-[11px] text-muted mt-0.5">{m.brand}</div>
                                    </div>
                                );
                            }}
                        />
                    </div>
                </div>

                {/* Batch type tabs */}
                <div>
                    <label className={labelCls}>{t('addBatchModal.type')}</label>
                    <div className="flex bg-surface p-1 rounded-2xl shadow-(--shadow-inset)">
                        {(['Single Origin', 'Pre-roast Blend', 'Post-roast Blend'] as BatchType[]).map((bt) => (
                            <button
                                key={bt}
                                type="button"
                                onClick={() => setBatchType(bt)}
                                className={tabCls(batchType === bt)}
                            >
                                {bt === 'Single Origin'
                                    ? t('addBatchModal.batchType.singleOrigin')
                                    : bt === 'Pre-roast Blend'
                                      ? t('addBatchModal.batchType.preRoastBlend')
                                      : t('addBatchModal.batchType.postRoastBlend')}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Profile + Bean/Blend */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>{t('addBatchModal.roastProfile')}</label>
                        <SearchableSelect
                            placeholder={t('addBatchModal.profilePlaceholder')}
                            items={profileItems}
                            selectedId={profileId}
                            onSelect={handleProfileSelect}
                            renderLabel={(item) => (item as RoastProfile).name}
                            renderOption={(item) => {
                                const p = item as RoastProfile;
                                return (
                                    <div>
                                        <div className="text-primary font-medium">{p.name}</div>
                                        <div className="text-[11px] text-muted mt-0.5">{p.target_level}</div>
                                    </div>
                                );
                            }}
                        />
                    </div>
                    <div>
                        {batchType === 'Single Origin' ? (
                            <>
                                <label className={labelCls}>
                                    <Package size={12} /> Green Coffee Lot
                                </label>
                                <SearchableSelect
                                    placeholder={t('addBatchModal.lotPlaceholder')}
                                    items={beanItems}
                                    selectedId={beanId}
                                    onSelect={setBeanId}
                                    renderLabel={(item) => (item as Bean).name}
                                    renderOption={(item) => {
                                        const b = item as Bean;
                                        const kg = ((stockSummaries[b.id]?.effectiveGrams ?? 0) / 1000).toFixed(1);
                                        return (
                                            <div>
                                                <div className="text-primary font-medium">{b.name}</div>
                                                <div className="text-[11px] text-muted mt-0.5">
                                                    {t('addBatchModal.stock', { kg })}
                                                    {b.origin && ` · ${b.origin}`}
                                                </div>
                                            </div>
                                        );
                                    }}
                                />
                                {isShortage && (
                                    <p className="text-xs text-red-500 mt-1">
                                        {t('addBatchModal.shortage', {
                                            effective: stockSummary!.effectiveGrams,
                                            needed: plannedGrams,
                                        })}
                                    </p>
                                )}
                            </>
                        ) : (
                            <>
                                <label className={labelCls}>
                                    <Package size={12} /> {t('addBatchModal.blend')}
                                </label>
                                <SearchableSelect
                                    placeholder={t('addBatchModal.blendPlaceholder')}
                                    items={blends}
                                    selectedId={blendId ?? ''}
                                    onSelect={(id) => setBlendId(id || null)}
                                    renderLabel={(item) => (item as BlendWithComponents).name}
                                    renderOption={(item) => {
                                        const b = item as BlendWithComponents;
                                        const compCount = b.blend_components?.length ?? 0;
                                        return (
                                            <div>
                                                <div className="text-primary font-medium">{b.name}</div>
                                                <div className="text-[11px] text-muted mt-0.5">
                                                    {b.description ??
                                                        t('addBatchModal.blendComposition', { count: compCount })}
                                                </div>
                                            </div>
                                        );
                                    }}
                                />
                                {blendShortages.length > 0 && blendShortages.some((s) => s.isShort) && (
                                    <div className="mt-2 space-y-1">
                                        {blendShortages
                                            .filter((s) => s.isShort)
                                            .map((s) => (
                                                <p
                                                    key={s.beanName}
                                                    className="text-xs text-red-500 flex items-start gap-1"
                                                >
                                                    <AlertTriangle
                                                        size={11}
                                                        strokeWidth={2}
                                                        className="shrink-0 mt-0.5"
                                                    />
                                                    <span>
                                                        {t('addBatchModal.blendShortage', {
                                                            name: s.beanName,
                                                            effective: s.effectiveGrams,
                                                            needed: s.neededGrams,
                                                        })}
                                                    </span>
                                                </p>
                                            ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* 수량 — 목표 + Batch Size + Yield */}
                <div className="grid grid-cols-3 gap-4">
                    <CounterInput
                        label={t('addBatchModal.targetRoasted')}
                        placeholder="0"
                        value={targetRoasted}
                        onChange={setTargetRoasted}
                        step={0.1}
                    />
                    <CounterInput
                        label={t('addBatchModal.batchSize')}
                        value={batchSize}
                        onChange={setBatchSize}
                        step={1}
                    />
                    <CounterInput label={t('addBatchModal.yield')} value={yieldPct} onChange={setYieldPct} step={1} />
                </div>

                {/* 자동 계산 summary */}
                {targetNum > 0 && (
                    <div className="rounded-2xl bg-surface/50 dark:bg-surface-elevated border border-border dark:border-[#585d61] p-4">
                        <div className="flex items-stretch gap-0 divide-x divide-border-subtle">
                            <div className="flex-1 flex flex-col items-center py-1 px-4">
                                <span className="text-[26px] font-bold text-primary tabular-nums leading-none">
                                    {batchCount}
                                </span>
                                <span className="text-[11px] text-muted mt-1.5">{t('addBatchModal.batches')}</span>
                            </div>
                            <div className="flex-1 flex flex-col items-center py-1 px-4">
                                <span className="text-[26px] font-bold text-primary tabular-nums leading-none">
                                    {greenNeeded}
                                </span>
                                <span className="text-[11px] text-muted mt-1.5">{t('addBatchModal.greenNeeded')}</span>
                            </div>
                            <div className="flex-1 flex flex-col items-center py-1 px-4">
                                <span className="text-[26px] font-bold text-primary tabular-nums leading-none">
                                    {yieldNum}%
                                </span>
                                <span className="text-[11px] text-muted mt-1.5">{t('addBatchModal.yield')}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Green Lot 재고 확인 */}
                {selectedBean && (
                    <div
                        className={`rounded-2xl border p-4 transition-colors ${
                            !stockSufficient
                                ? 'border-amber-200 bg-amber-50'
                                : 'border-border dark:border-[#585d61] bg-surface/40 dark:bg-[#1a1e23]'
                        }`}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[13px] font-semibold text-primary">{selectedBean.name}</div>
                                <div className="text-[12px] text-secondary mt-0.5">
                                    {t('addBatchModal.currentStock')}{' '}
                                    <span className="font-medium text-primary">{effectiveStockKg.toFixed(1)} kg</span>
                                    {greenNeeded > 0 && (
                                        <span className="text-muted ml-2">
                                            {t('addBatchModal.needed')} {greenNeeded} kg
                                        </span>
                                    )}
                                </div>
                            </div>
                            {!stockSufficient && (
                                <div className="flex items-center gap-1.5 text-amber-600 text-[12px] font-semibold shrink-0">
                                    <AlertTriangle size={13} strokeWidth={2} />
                                    {t('addBatchModal.insufficientStock')}
                                </div>
                            )}
                        </div>
                        {greenNeeded > 0 && (
                            <div className="mt-3 h-1.5 rounded-full bg-black/6 dark:bg-white/8 overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-300 ${
                                        !stockSufficient ? 'bg-amber-400' : 'bg-surface-warm-solid'
                                    }`}
                                    style={{ width: `${stockPct}%` }}
                                />
                            </div>
                        )}
                    </div>
                )}

                {isRruleVisible && (
                    <div>
                        <label className={labelCls}>
                            <Repeat size={12} /> {t('addBatchModal.recurrence')}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => setRecurringInterval(null)}
                                className={cn(
                                    'px-3 py-2 rounded-xl text-[13px] font-medium transition-all border',
                                    recurringInterval === null
                                        ? 'bg-primary text-white dark:bg-transparent dark:text-secondary dark:border-[#585d61] border-primary shadow-sm dark:shadow-none'
                                        : 'bg-surface dark:bg-surface-elevated text-secondary border-border dark:border-[#585d61] hover:border-black/15',
                                )}
                            >
                                {t('addBatchModal.none')}
                            </button>
                            {RECURRENCE_OPTIONS.map(({ value }) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setRecurringInterval(value)}
                                    className={cn(
                                        'px-3 py-2 rounded-xl text-[13px] font-medium transition-all border',
                                        recurringInterval === value
                                            ? 'bg-primary text-white dark:bg-transparent dark:text-secondary dark:border-[#585d61] border-primary shadow-sm dark:shadow-none'
                                            : 'bg-surface dark:bg-surface-elevated text-secondary border-border dark:border-[#585d61] hover:border-black/15',
                                    )}
                                >
                                    {t('schedule.recurrence.' + value)}
                                </button>
                            ))}
                        </div>
                        {recurringHorizonShort && (
                            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/50 px-3.5 py-2.5">
                                <AlertTriangle size={14} strokeWidth={2} className="text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-[12px] text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
                                    {t('addBatchModal.recurringStockShort', {
                                        needed: recurringHorizonShort.neededKg,
                                        available: recurringHorizonShort.availableKg,
                                    })}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* Notes */}
                <div>
                    <label className={labelCls}>{t('addBatchModal.notes')}</label>
                    <textarea
                        className={`${inputCls} resize-none`}
                        rows={3}
                        placeholder={t('addBatchModal.notesPlaceholder')}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />
                </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-black/4 dark:border-[#585d61] bg-white/60 dark:bg-[#1a1e23] px-8 py-4 flex items-center justify-between gap-3">
                {dateChanged && newDateKey && (
                    <p className="text-[12px] text-amber-600 font-medium">
                        {t('addBatchModal.dateChanged', {
                            date: format(new Date(newDateKey + 'T00:00:00'), 'M월 d일', { locale: getDateFnsLocale() }),
                        })}
                    </p>
                )}
                <div className="flex items-center gap-3 ml-auto">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-xl border border-border dark:border-[#585d61] bg-surface dark:bg-surface-elevated text-secondary text-[13px] font-medium cursor-pointer hover:bg-surface-raised transition-colors shadow-(--shadow-inset)"
                    >
                        {t('addBatchModal.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="px-5 py-2.5 rounded-xl border border-transparent dark:border-white bg-primary dark:bg-black text-white dark:text-white text-[13px] font-semibold cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {saving
                            ? t('addBatchModal.saving')
                            : isEdit
                              ? t('addBatchModal.save')
                              : t('addBatchModal.addBatch')}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};
