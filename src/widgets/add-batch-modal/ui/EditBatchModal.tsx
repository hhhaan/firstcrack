import { useState, useEffect } from 'react';
import { X, CalendarIcon, Cpu, Package, AlertTriangle } from 'lucide-react';
import { CounterInput } from '@shared/ui/CounterInput';
import { SearchableSelect } from './SearchableSelect';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Calendar } from '@shared/ui/calendar/Calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { useAuthStore } from '@shared/store/auth';
import { useBeans } from '@entities/bean/queries';
import { useMachines, type Machine } from '@entities/machine';
import { dayPlanApi, planBatchApi, planKeys } from '@entities/plan';
import { supabase } from '@shared/lib/supabase';
import { cn } from '@shared/lib/cn';
import type { RoastProfile, Bean, PlanBatchWithProgress } from '@shared/types/database.types';

// ── Style helpers ─────────────────────────────────────────────────────────────

const inputCls =
    'w-full px-3.5 py-2.5 rounded-xl border border-black/8 bg-white/80 shadow-(--shadow-inset) text-sm text-primary outline-none transition-all focus:border-black/20';
const labelCls =
    'flex items-center gap-1.5 text-[11px] font-semibold text-muted mb-1.5 tracking-[0.04em] uppercase';
const tabCls = (active: boolean) =>
    `flex-1 py-2 rounded-xl border-none text-[13px] cursor-pointer transition-all duration-200 ${
        active
            ? 'bg-white font-semibold text-primary shadow-[0_2px_8px_rgba(0,0,0,0.08)]'
            : 'bg-transparent font-medium text-muted hover:text-secondary'
    }`;

type BatchType = 'Single Origin' | 'Pre-roast Blend' | 'Post-roast Blend';

// ── Main component ────────────────────────────────────────────────────────────

interface EditBatchModalProps {
    open: boolean;
    batch: PlanBatchWithProgress | null;
    currentDateKey: string;
    onClose: () => void;
    onSaved: () => void;
}

export const EditBatchModal = ({ open, batch, currentDateKey, onClose, onSaved }: EditBatchModalProps) => {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const qc = useQueryClient();
    const { data: beans = [] } = useBeans(userId);
    const { machines } = useMachines();

    const { data: profiles = [] } = useQuery({
        queryKey: ['roast_profiles', userId],
        queryFn: async () => {
            const { data, error } = await supabase.from('roast_profiles').select('*').eq('user_id', userId).order('name');
            if (error) throw error;
            return (data ?? []) as RoastProfile[];
        },
        enabled: !!userId && open,
        staleTime: 60_000,
    });

    // Initial values from batch — component is re-keyed by batch.id so no effect needed
    const [saving, setSaving] = useState(false);
    const [date, setDate] = useState<Date | undefined>(
        () => new Date(currentDateKey + 'T00:00:00'),
    );
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [machineId, setMachineId] = useState(() => batch?.machine_id ?? '');
    const [batchType, setBatchType] = useState<BatchType>(
        () => (batch?.batch_type as BatchType) || 'Single Origin',
    );
    const [profileId, setProfileId] = useState(() => batch?.roast_profile_id ?? '');
    const [beanId, setBeanId] = useState(() => batch?.bean_id ?? '');
    const [targetRoasted, setTargetRoasted] = useState(
        () => (batch ? String(batch.target_roasted_kg) : ''),
    );
    const [batchSize, setBatchSize] = useState(
        () => (batch ? String(batch.batch_size_kg) : ''),
    );
    const [yieldPct, setYieldPct] = useState(
        () => (batch ? String(Math.round((batch.yield_pct ?? 0.82) * 100)) : ''),
    );
    const [notes, setNotes] = useState(() => batch?.notes ?? '');

    useEffect(() => {
        if (!open) return;
        const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', fn);
        return () => window.removeEventListener('keydown', fn);
    }, [open, onClose]);

    const targetNum = parseFloat(targetRoasted) || 0;
    const batchSizeNum = parseFloat(batchSize) || 25;
    const yieldNum = parseFloat(yieldPct) || 82;
    const batchCount = targetNum > 0 ? Math.ceil(targetNum / batchSizeNum) : 0;
    const greenNeeded = targetNum > 0 && yieldNum > 0 ? Math.round((targetNum / (yieldNum / 100)) * 10) / 10 : 0;

    const selectedBean = beans.find((b) => b.id === beanId) as Bean | undefined;
    const stockKg = selectedBean ? selectedBean.stock_grams / 1000 : 0;
    const stockSufficient = greenNeeded === 0 || stockKg >= greenNeeded;
    const stockPct = greenNeeded > 0 ? Math.min(100, (stockKg / greenNeeded) * 100) : 100;

    const newDateKey = date ? format(date, 'yyyy-MM-dd') : currentDateKey;
    const dateChanged = newDateKey !== currentDateKey;

    const canSave = !!batch && date !== undefined && targetNum > 0 && batchSizeNum > 0 && !saving;

    const handleSave = async () => {
        if (!canSave || !batch) return;
        setSaving(true);
        try {
            let targetPlanId = batch.plan_id;

            // If date changed, get-or-create the target day plan
            if (dateChanged) {
                const newPlan = await dayPlanApi.getOrCreate(userId, newDateKey);
                targetPlanId = newPlan.id;
            }

            // If date changed, move the batch to the new plan first
            if (dateChanged) {
                await planBatchApi.move(batch.id, targetPlanId);
            }

            await planBatchApi.update({
                id: batch.id,
                machine_id: machineId || null,
                batch_type: batchType,
                roast_profile_id: profileId || null,
                bean_id: beanId || null,
                bean_name: selectedBean?.name ?? batch.bean_name,
                target_roasted_kg: targetNum,
                batch_size_kg: batchSizeNum,
                yield_pct: yieldNum / 100,
                green_lot: selectedBean ? `${selectedBean.name} (${stockKg.toFixed(0)}kg)` : batch.green_lot,
                notes,
            });

            // Invalidate old plan's batches
            qc.invalidateQueries({ queryKey: planKeys.batches(batch.plan_id) });
            // If date changed, also invalidate new plan and range summaries
            if (dateChanged) {
                qc.invalidateQueries({ queryKey: planKeys.batches(targetPlanId) });
                qc.invalidateQueries({ queryKey: ['day_plan_range', userId] });
            }

            onSaved();
            onClose();
        } catch (err) {
            console.error('[EditBatchModal] save failed:', err);
            alert(`저장 실패: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setSaving(false);
        }
    };

    if (!open || !batch) return null;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="edit-batch-modal-title"
            contentClassName="max-w-[600px] w-full max-h-[min(840px,calc(100vh-64px))] flex flex-col rounded-[28px] bg-[rgba(255,255,255,0.97)] backdrop-[blur(20px)_saturate(180%)] shadow-[0_32px_80px_rgba(22,18,12,0.22)] border border-white overflow-hidden"
        >
            {/* Header */}
            <div className="shrink-0 bg-white/60 backdrop-blur-sm border-b border-black/4 px-8 pt-6 pb-5 flex items-center justify-between">
                <div>
                    <h2 id="edit-batch-modal-title" className="font-(--font-display) text-[22px] text-primary tracking-[-0.02em] m-0">
                        배치 편집
                    </h2>
                    <p className="text-[12px] text-muted mt-0.5 m-0">{batch.bean_name}</p>
                </div>
                <button type="button" onClick={onClose} className="w-9 h-9 rounded-xl border-none bg-surface text-muted flex items-center justify-center cursor-pointer transition-all hover:text-primary">
                    <X size={17} strokeWidth={2.5} />
                </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6">

                {/* 날짜 + 머신 */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}><CalendarIcon size={12} /> 날짜</label>
                        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className={cn(inputCls, 'flex items-center gap-2 text-left cursor-pointer', !date && 'text-muted')}
                                >
                                    <CalendarIcon size={13} className="text-muted shrink-0" />
                                    <span>{date ? format(date, 'M월 d일 (eee)', { locale: ko }) : '날짜 선택'}</span>
                                    {dateChanged && <span className="ml-auto text-[10px] text-amber-600 font-semibold shrink-0">이동</span>}
                                </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <Calendar mode="single" selected={date} onSelect={(d) => { setDate(d); setCalendarOpen(false); }} locale={ko} />
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div>
                        <label className={labelCls}><Cpu size={12} /> 머신</label>
                        <SearchableSelect
                            placeholder="머신 선택..."
                            items={machines}
                            selectedId={machineId}
                            onSelect={setMachineId}
                            renderLabel={(item) => { const m = item as Machine; return m.name || m.displayName; }}
                            renderOption={(item) => {
                                const m = item as Machine;
                                return <div><div className="text-primary font-medium">{m.name || m.displayName}</div><div className="text-[11px] text-muted mt-0.5">{m.brand}</div></div>;
                            }}
                        />
                    </div>
                </div>

                {/* Batch type */}
                <div>
                    <label className={labelCls}>구분</label>
                    <div className="flex bg-surface p-1 rounded-2xl shadow-(--shadow-inset)">
                        {(['Single Origin', 'Pre-roast Blend', 'Post-roast Blend'] as BatchType[]).map((t) => (
                            <button key={t} type="button" onClick={() => setBatchType(t)} className={tabCls(batchType === t)}>{t}</button>
                        ))}
                    </div>
                </div>

                {/* Profile + Bean */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>로스트 프로파일</label>
                        <SearchableSelect
                            placeholder="프로파일 선택..."
                            items={profiles}
                            selectedId={profileId}
                            onSelect={setProfileId}
                            renderLabel={(item) => (item as RoastProfile).name}
                            renderOption={(item) => {
                                const p = item as RoastProfile;
                                return <div><div className="text-primary font-medium">{p.name}</div><div className="text-[11px] text-muted mt-0.5">{p.target_level}</div></div>;
                            }}
                        />
                    </div>
                    <div>
                        <label className={labelCls}><Package size={12} /> Green Coffee Lot</label>
                        <SearchableSelect
                            placeholder="Lot 선택..."
                            items={beans}
                            selectedId={beanId}
                            onSelect={setBeanId}
                            renderLabel={(item) => (item as Bean).name}
                            renderOption={(item) => {
                                const b = item as Bean;
                                return <div><div className="text-primary font-medium">{b.name}</div><div className="text-[11px] text-muted mt-0.5">재고 {(b.stock_grams / 1000).toFixed(1)} kg{b.origin && ` · ${b.origin}`}</div></div>;
                            }}
                        />
                    </div>
                </div>

                {/* 수량 */}
                <div className="grid grid-cols-3 gap-4">
                    <CounterInput
                        label="목표 Roasted (kg)"
                        placeholder="0"
                        value={targetRoasted}
                        onChange={setTargetRoasted}
                        step={0.1}
                    />
                    <CounterInput
                        label="Batch Size (kg)"
                        value={batchSize}
                        onChange={setBatchSize}
                        step={1}
                    />
                    <CounterInput
                        label="Yield (%)"
                        value={yieldPct}
                        onChange={setYieldPct}
                        step={1}
                    />
                </div>

                {/* 자동 계산 summary */}
                {targetNum > 0 && (
                    <div className="rounded-2xl bg-surface/50 border border-border p-4">
                        <div className="flex items-stretch gap-0 divide-x divide-border-subtle">
                            <div className="flex-1 flex flex-col items-center py-1 px-4">
                                <span className="text-[26px] font-bold text-primary tabular-nums leading-none">{batchCount}</span>
                                <span className="text-[11px] text-muted mt-1.5">배치</span>
                            </div>
                            <div className="flex-1 flex flex-col items-center py-1 px-4">
                                <span className="text-[26px] font-bold text-primary tabular-nums leading-none">{greenNeeded}</span>
                                <span className="text-[11px] text-muted mt-1.5">Green 필요 (kg)</span>
                            </div>
                            <div className="flex-1 flex flex-col items-center py-1 px-4">
                                <span className="text-[26px] font-bold text-primary tabular-nums leading-none">{yieldNum}%</span>
                                <span className="text-[11px] text-muted mt-1.5">Yield</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Green Lot 재고 */}
                {selectedBean && (
                    <div className={`rounded-2xl border p-4 transition-colors ${!stockSufficient ? 'border-amber-200 bg-amber-50' : 'border-border bg-surface/40'}`}>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[13px] font-semibold text-primary">{selectedBean.name}</div>
                                <div className="text-[12px] text-secondary mt-0.5">
                                    현재 재고: <span className="font-medium text-primary">{stockKg.toFixed(1)} kg</span>
                                    {greenNeeded > 0 && <span className="text-muted ml-2">/ 필요: {greenNeeded} kg</span>}
                                </div>
                            </div>
                            {!stockSufficient && (
                                <div className="flex items-center gap-1.5 text-amber-600 text-[12px] font-semibold shrink-0">
                                    <AlertTriangle size={13} strokeWidth={2} /> 재고 부족
                                </div>
                            )}
                        </div>
                        {greenNeeded > 0 && (
                            <div className="mt-3 h-1.5 rounded-full bg-black/6 overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-300 ${!stockSufficient ? 'bg-amber-400' : 'bg-surface-warm-solid'}`} style={{ width: `${stockPct}%` }} />
                            </div>
                        )}
                    </div>
                )}

                {/* Notes */}
                <div>
                    <label className={labelCls}>메모 (Notes)</label>
                    <textarea className={`${inputCls} resize-none`} rows={3} placeholder="특이사항, 고객사용 등..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-black/4 bg-white/60 px-8 py-4 flex items-center justify-between gap-3">
                {dateChanged && (
                    <p className="text-[12px] text-amber-600 font-medium">
                        {format(new Date(newDateKey + 'T00:00:00'), 'M월 d일', { locale: ko })}로 이동됩니다
                    </p>
                )}
                <div className="flex items-center gap-3 ml-auto">
                    <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl border border-border bg-surface text-secondary text-[13px] font-medium cursor-pointer hover:bg-surface-raised transition-colors shadow-(--shadow-inset)">
                        취소
                    </button>
                    <button type="button" onClick={handleSave} disabled={!canSave} className="px-5 py-2.5 rounded-xl border-none bg-primary text-white text-[13px] font-semibold cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
                        {saving ? '저장 중...' : '저장'}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};
