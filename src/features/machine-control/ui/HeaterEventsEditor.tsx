import { formErrorCls, inputCls, modalCancelBtnCls, modalPrimaryBtnCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    formatEditTime,
    type HeaterBounds,
    heaterFitsBounds,
    normalizeHeaterPlan,
    parseEditTime,
    parseFiniteNumber,
    type ReplayPlanSource,
} from '../lib/heater-events';
import { eventTrigger, MAX_EVENTS, type ReplayEvent, type ReplayPoint, type ReplayTrigger } from '../lib/replay';

type DraftRow = {
    key: string;
    t: string;
    bt: string;
    heater: string;
    trigger: ReplayTrigger;
};

export type HeaterEventsEditorMode = 'profile' | 'batch';

type Props = {
    mode: HeaterEventsEditorMode;
    events: ReplayEvent[];
    tpTime: number;
    btPoints: ReplayPoint[];
    source: ReplayPlanSource | null;
    unit: 'C' | 'F';
    heaterMin?: number;
    heaterMax?: number;
    heaterUnit?: string;
    heaterStep?: number;
    /** ACK된 앞쪽 행. 실행 중에는 값을 바꿔도 다시 보내지 않는다. */
    lockedCount?: number;
    boundsNote?: string;
    onClose: () => void;
    onApply: (events: ReplayEvent[] | null) => void | Promise<void>;
};

const toDisplayBt = (c: number, unit: 'C' | 'F') => (unit === 'F' ? (c * 9) / 5 + 32 : c);
const fromDisplayBt = (v: number, unit: 'C' | 'F') => (unit === 'F' ? ((v - 32) * 5) / 9 : v);

const toDraft = (events: ReplayEvent[], tpTime: number, unit: 'C' | 'F'): DraftRow[] =>
    events.map((e, i) => ({
        key: e.id ?? `${i}-${e.t}-${e.heater}-${e.trigger ?? ''}`,
        t: formatEditTime(e.t),
        bt: String(Math.round(toDisplayBt(e.bt, unit) * 10) / 10),
        heater: String(e.heater),
        trigger: eventTrigger(e, tpTime),
    }));

const parseRows = (rows: DraftRow[], unit: 'C' | 'F', bounds: HeaterBounds): ReplayEvent[] | null => {
    const events: ReplayEvent[] = [];
    for (const row of rows) {
        const t = parseEditTime(row.t);
        const btDisplay = parseFiniteNumber(row.bt);
        const heater = parseFiniteNumber(row.heater);
        if (t == null || btDisplay == null || heater == null) return null;
        const bt = fromDisplayBt(btDisplay, unit);
        if (!Number.isFinite(bt)) return null;
        if (!heaterFitsBounds(heater, bounds)) return null;
        events.push({ t, bt, heater, trigger: row.trigger, id: row.key });
    }
    return events;
};

export const HeaterEventsEditor = ({
    mode,
    events,
    tpTime,
    btPoints,
    source,
    unit,
    heaterMin,
    heaterMax,
    heaterUnit = '%',
    heaterStep,
    lockedCount = 0,
    boundsNote,
    onClose,
    onApply,
}: Props) => {
    const heaterBounds: HeaterBounds = useMemo(
        () => ({
            min: heaterMin ?? 0,
            max: heaterMax ?? 100,
            ...(heaterStep != null && heaterStep > 0 ? { step: heaterStep } : {}),
        }),
        [heaterMin, heaterMax, heaterStep],
    );
    const { t } = useTranslation();
    const [rows, setRows] = useState<DraftRow[]>(() => toDraft(events, tpTime, unit));
    const [error, setError] = useState<string | null>(null);
    const [ruleBt, setRuleBt] = useState(() => String(toDisplayBt(192, unit)));
    const [ruleHeater, setRuleHeater] = useState('50');
    const [selected, setSelected] = useState(0);
    const [busy, setBusy] = useState(false);

    const onEscape = useEffectEvent(() => {
        if (!busy) onClose();
    });
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopImmediatePropagation();
            onEscape();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, []);

    const parsed = useMemo(() => parseRows(rows, unit, heaterBounds) ?? [], [rows, unit, heaterBounds]);

    const update = (key: string, patch: Partial<DraftRow>) => {
        setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
        setError(null);
    };

    const addStep = () => {
        setSelected(rows.length);
        setError(null);
        const last = parsed[parsed.length - 1];
        setRows((prev) => [
            ...prev,
            {
                key: `new-${Date.now()}`,
                t: formatEditTime((last?.t ?? 0) + 30),
                bt: String(Math.round(toDisplayBt(last?.bt ?? 180, unit) * 10) / 10),
                heater: String(last?.heater ?? 50),
                trigger: 'time',
            },
        ]);
    };

    const addBtRule = () => {
        const bt = parseFiniteNumber(ruleBt);
        const heater = parseFiniteNumber(ruleHeater);
        if (bt == null || heater == null || !heaterFitsBounds(heater, heaterBounds)) {
            setError(t('heaterEventsEditor.invalid'));
            return;
        }
        setSelected(rows.length);
        setRows((prev) => [
            ...prev,
            {
                key: `bt-${Date.now()}`,
                t: formatEditTime(parsed[parsed.length - 1]?.t ?? 0),
                bt: String(bt),
                heater: String(heater),
                trigger: 'bt',
            },
        ]);
        setError(null);
    };

    const handleApply = async (next: ReplayEvent[] | null) => {
        if (next && next.length > 0 && !normalizeHeaterPlan(next, tpTime, heaterBounds)) {
            setError(t(next.length > MAX_EVENTS ? 'heaterEventsEditor.tooMany' : 'heaterEventsEditor.invalid'));
            return;
        }
        if (busy) return;
        setError(null);
        setBusy(true);
        try {
            await onApply(next && next.length > 0 ? next : null);
        } catch {
            setError(t('heaterEventsEditor.saveFailed'));
        } finally {
            setBusy(false);
        }
    };

    const submit = () => {
        const next = parseRows(rows, unit, heaterBounds);
        if (!next) {
            setError(t('heaterEventsEditor.invalid'));
            return;
        }
        void handleApply(next);
    };

    const sourceLabel =
        source === 'batch'
            ? t('heaterEventsEditor.sourceBatch')
            : source === 'profile'
              ? t('heaterEventsEditor.sourceProfile')
              : t('heaterEventsEditor.sourceTsv');

    return (
        <ModalShell
            onClose={() => {
                if (!busy) onClose();
            }}
            dismissable={false}
            labelledBy="heater-events-editor-title"
            contentClassName={`${modalPanel.compare} !h-[min(760px,calc(100dvh-48px))]`}
            overlayClassName="!z-[1100]"
            data-testid="heater-events-editor"
        >
            <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-black/4 px-6 pt-5 pb-3 dark:border-[#585d61]">
                    <ModalHeader
                        titleId="heater-events-editor-title"
                        title={t('heaterEventsEditor.title')}
                        subtitle={
                            mode === 'batch'
                                ? t('heaterEventsEditor.subtitleBatch')
                                : t('heaterEventsEditor.subtitleProfile')
                        }
                        onClose={() => {
                            if (!busy) onClose();
                        }}
                        closeLabel={t('common.close')}
                        className="px-0 pt-0 pb-0"
                    />
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-black/5 px-6 py-2 text-xs text-muted">
                    <span className="inline-flex h-[22px] items-center rounded-full bg-surface px-2 font-semibold text-secondary">
                        {sourceLabel}
                    </span>
                    {boundsNote && <span>{boundsNote}</span>}
                    {source && source !== 'tsv' && (
                        <button
                            type="button"
                            className="ml-auto cursor-pointer border-none bg-transparent text-xs font-medium text-red-600"
                            disabled={busy}
                            onClick={() => void handleApply(null)}
                        >
                            {t('heaterEventsEditor.revert')}
                        </button>
                    )}
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <div className="h-52 shrink-0 border-b border-border-subtle px-6 py-3">
                        <HeatStepChart
                            events={parsed}
                            btPoints={btPoints}
                            unit={unit}
                            heaterUnit={heaterUnit}
                            heaterMax={heaterBounds.max}
                            selected={selected}
                            onSelect={setSelected}
                        />
                    </div>
                    <HeaterEventsTable
                        unit={unit}
                        heaterUnit={heaterUnit}
                        busy={busy}
                        rows={rows}
                        selected={selected}
                        lockedCount={lockedCount}
                        error={error}
                        ruleBt={ruleBt}
                        ruleHeater={ruleHeater}
                        onRuleBt={setRuleBt}
                        onRuleHeater={setRuleHeater}
                        onAddBtRule={addBtRule}
                        onAddStep={addStep}
                        onSelect={setSelected}
                        onUpdate={update}
                        onDelete={(key) => setRows((prev) => prev.filter((r) => r.key !== key))}
                    />
                </div>
                <div className="flex shrink-0 gap-3 border-t border-black/4 px-6 pt-4 pb-5 dark:border-[#585d61]">
                    <button type="button" onClick={onClose} disabled={busy} className={modalCancelBtnCls}>
                        {t('heaterEventsEditor.cancel')}
                    </button>
                    <button type="button" onClick={submit} disabled={busy} className={modalPrimaryBtnCls}>
                        {busy
                            ? t('heaterEventsEditor.saving')
                            : mode === 'batch'
                              ? t('heaterEventsEditor.applyBatch')
                              : t('heaterEventsEditor.save')}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};

const HeaterEventsTable = ({
    unit,
    heaterUnit,
    busy,
    rows,
    selected,
    lockedCount,
    error,
    ruleBt,
    ruleHeater,
    onRuleBt,
    onRuleHeater,
    onAddBtRule,
    onAddStep,
    onSelect,
    onUpdate,
    onDelete,
}: {
    unit: 'C' | 'F';
    heaterUnit: string;
    busy: boolean;
    rows: DraftRow[];
    selected: number;
    lockedCount: number;
    error: string | null;
    ruleBt: string;
    ruleHeater: string;
    onRuleBt: (value: string) => void;
    onRuleHeater: (value: string) => void;
    onAddBtRule: () => void;
    onAddStep: () => void;
    onSelect: (index: number) => void;
    onUpdate: (key: string, patch: Partial<DraftRow>) => void;
    onDelete: (key: string) => void;
}) => {
    const { t } = useTranslation();
    return (
        <fieldset disabled={busy} className="m-0 flex min-h-[240px] min-w-0 flex-1 flex-col border-0 px-6 py-4">
            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-surface/60 p-3">
                <label className="min-w-0 flex-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
                    {t('heaterEventsEditor.ruleWhen')} (°{unit})
                    <input
                        value={ruleBt}
                        onChange={(e) => onRuleBt(e.target.value)}
                        className={`${inputCls} mt-1 py-1.5 text-xs`}
                        inputMode="decimal"
                        aria-label={t('heaterEventsEditor.bt')}
                    />
                </label>
                <label className="min-w-0 flex-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
                    {t('heaterEventsEditor.ruleThen')} ({heaterUnit})
                    <input
                        value={ruleHeater}
                        onChange={(e) => onRuleHeater(e.target.value)}
                        className={`${inputCls} mt-1 py-1.5 text-xs`}
                        inputMode="decimal"
                        aria-label={t('heaterEventsEditor.heat')}
                    />
                </label>
                <button
                    type="button"
                    disabled={busy || rows.length >= MAX_EVENTS}
                    onClick={onAddBtRule}
                    className="mb-0.5 cursor-pointer rounded-xl border-none bg-surface px-2.5 py-2 text-xs font-medium text-primary"
                >
                    {t('heaterEventsEditor.ruleAdd')}
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[480px] table-fixed border-collapse text-xs">
                    <thead>
                        <tr className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                            <th className="sticky top-0 z-10 bg-main-bg px-2 pb-2 text-left">
                                {t('heaterEventsEditor.time')} (m:ss)
                            </th>
                            <th className="sticky top-0 z-10 bg-main-bg px-2 pb-2 text-left">
                                {t('heaterEventsEditor.bt')} (°{unit})
                            </th>
                            <th className="sticky top-0 z-10 bg-main-bg px-2 pb-2 text-left">
                                {t('heaterEventsEditor.heat')} ({heaterUnit})
                            </th>
                            <th className="sticky top-0 z-10 bg-main-bg px-2 pb-2 text-left">
                                {t('heaterEventsEditor.trigger')}
                            </th>
                            <th className="sticky top-0 z-10 w-10 bg-main-bg pb-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => {
                            const locked = i < lockedCount;
                            return (
                                <tr
                                    key={row.key}
                                    className={i === selected ? 'bg-surface' : undefined}
                                    onClick={() => onSelect(i)}
                                    onFocus={() => onSelect(i)}
                                >
                                    <td className="py-1 pr-1">
                                        <input
                                            value={row.t}
                                            onChange={(e) => onUpdate(row.key, { t: e.target.value })}
                                            className={`${inputCls} py-1.5 text-xs`}
                                            aria-label={t('heaterEventsEditor.time')}
                                            readOnly={locked}
                                        />
                                    </td>
                                    <td className="py-1 pr-1">
                                        <input
                                            value={row.bt}
                                            onChange={(e) => onUpdate(row.key, { bt: e.target.value })}
                                            className={`${inputCls} py-1.5 text-xs`}
                                            inputMode="decimal"
                                            aria-label={t('heaterEventsEditor.bt')}
                                            readOnly={locked}
                                        />
                                    </td>
                                    <td className="py-1 pr-1">
                                        <input
                                            value={row.heater}
                                            onChange={(e) => onUpdate(row.key, { heater: e.target.value })}
                                            className={`${inputCls} py-1.5 text-xs`}
                                            inputMode="decimal"
                                            aria-label={t('heaterEventsEditor.heat')}
                                            readOnly={locked}
                                        />
                                    </td>
                                    <td className="py-1 pr-1">
                                        <select
                                            value={row.trigger}
                                            onChange={(e) =>
                                                onUpdate(row.key, {
                                                    trigger: e.target.value as ReplayTrigger,
                                                })
                                            }
                                            className={`${inputCls} py-1.5 pr-6 text-xs`}
                                            aria-label={t('heaterEventsEditor.trigger')}
                                            disabled={locked}
                                        >
                                            <option value="time">{t('heaterEventsEditor.triggerTime')}</option>
                                            <option value="bt">{t('heaterEventsEditor.triggerBt')}</option>
                                        </select>
                                    </td>
                                    <td className="py-1">
                                        <button
                                            type="button"
                                            className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg border-none bg-transparent text-muted hover:bg-surface hover:text-red-600"
                                            aria-label={t('heaterEventsEditor.deleteRow')}
                                            disabled={locked}
                                            onClick={() => onDelete(row.key)}
                                        >
                                            <Trash2 size={14} strokeWidth={2} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {rows.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted">{t('heaterEventsEditor.empty')}</p>
                )}
            </div>
            <button
                type="button"
                disabled={busy || rows.length >= MAX_EVENTS}
                onClick={onAddStep}
                className="mt-2 inline-flex cursor-pointer items-center gap-1 border-none bg-transparent text-xs font-medium text-secondary"
            >
                <Plus size={14} strokeWidth={2} />
                {t('heaterEventsEditor.addStep')}
            </button>
            {error && (
                <p role="alert" className={formErrorCls}>
                    {error}
                </p>
            )}
        </fieldset>
    );
};

const CHART_PAD = { l: 48, r: 52, t: 16, b: 28 };
const CHART_WIDTH = 1040;
const CHART_HEIGHT = 180;

const HeatStepChart = ({
    events,
    btPoints,
    unit,
    heaterUnit,
    heaterMax,
    selected,
    onSelect,
}: {
    events: ReplayEvent[];
    btPoints: ReplayPoint[];
    unit: 'C' | 'F';
    heaterUnit: string;
    heaterMax: number;
    selected: number;
    onSelect: (index: number) => void;
}) => {
    const { t } = useTranslation();
    const width = CHART_WIDTH;
    const height = CHART_HEIGHT;
    const pad = CHART_PAD;
    const maxT = Math.max(60, ...btPoints.map((p) => p.t), ...events.map((e) => e.t), 1);
    const bts: number[] = [];
    for (const p of btPoints) {
        if (Number.isFinite(p.bt)) bts.push(p.bt);
    }
    const minBt = (bts.length ? Math.min(...bts) : 80) - 10;
    const maxBt = (bts.length ? Math.max(...bts) : 220) + 10;
    const heatMax = Math.max(heaterMax, ...events.map((e) => e.heater), 1);
    const innerW = width - pad.l - pad.r;
    const innerH = height - pad.t - pad.b;
    const x = (t: number) => pad.l + (t / maxT) * innerW;
    const yBt = (bt: number) => pad.t + (1 - (bt - minBt) / (maxBt - minBt || 1)) * innerH;
    const yHeat = (h: number) => pad.t + (1 - h / heatMax) * innerH;
    const btPath = btPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t)} ${yBt(p.bt)}`).join(' ');
    const heatPath =
        events.length === 0
            ? ''
            : `M${x(events[0].t)} ${yHeat(events[0].heater)}${events
                  .slice(1)
                  .map((e) => ` H${x(e.t)} V${yHeat(e.heater)}`)
                  .join('')} H${x(maxT)}`;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-muted">
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-4 bg-(--color-control-heat)" />
                    {t('heaterEventsEditor.chartHeat')} ({heaterUnit})
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-4 bg-(--color-sensor-bt)" />
                    {t('heaterEventsEditor.chartBt')} (°{unit})
                </span>
                <span className="ml-auto font-normal">{t('heaterEventsEditor.chartHint')}</span>
            </div>
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="min-h-0 flex-1 w-full"
                role="group"
                aria-label={t('heaterEventsEditor.chartHeat')}
            >
                {[0, 0.5, 1].map((ratio) => (
                    <g key={ratio}>
                        <line
                            x1={pad.l}
                            x2={width - pad.r}
                            y1={yHeat(ratio * heatMax)}
                            y2={yHeat(ratio * heatMax)}
                            stroke="var(--color-chart-grid)"
                        />
                        <text
                            x={pad.l - 6}
                            y={yHeat(ratio * heatMax) + 4}
                            textAnchor="end"
                            fill="var(--color-chart-axis-label)"
                            fontSize="11"
                        >
                            {Math.round(ratio * heatMax)}
                            {heaterUnit}
                        </text>
                        <text
                            x={width - pad.r + 6}
                            y={yHeat(ratio * heatMax) + 4}
                            fill="var(--color-chart-axis-label)"
                            fontSize="11"
                        >
                            {Math.round(toDisplayBt(minBt + ratio * (maxBt - minBt), unit))}°
                        </text>
                        <text
                            x={x(ratio * maxT)}
                            y={height - 6}
                            textAnchor="middle"
                            fill="var(--color-chart-axis-label)"
                            fontSize="11"
                        >
                            {formatEditTime(ratio * maxT)}
                        </text>
                    </g>
                ))}
                {btPath && <path d={btPath} fill="none" stroke="var(--color-sensor-bt)" strokeWidth="1.6" />}
                {events.length > 0 && (
                    <path
                        d={heatPath}
                        fill="none"
                        stroke="var(--color-control-heat)"
                        strokeWidth="1.2"
                        strokeDasharray="4 3"
                    />
                )}
                {events.map((e, i) => (
                    <g
                        key={`${e.t}-${e.heater}-${i}`}
                        className="cursor-pointer"
                        role="button"
                        tabIndex={0}
                        aria-label={`${formatEditTime(e.t)}, ${e.heater}${heaterUnit}`}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onSelect(i);
                            }
                        }}
                        onClick={() => onSelect(i)}
                    >
                        <circle cx={x(e.t)} cy={yHeat(e.heater)} r="12" fill="transparent" />
                        <circle
                            cx={x(e.t)}
                            cy={yHeat(e.heater)}
                            r={i === selected ? 5 : 3.5}
                            fill={i === selected ? 'var(--color-control-heat)' : 'var(--color-main-bg)'}
                            stroke="var(--color-control-heat)"
                            strokeWidth="1.5"
                        />
                    </g>
                ))}
            </svg>
        </div>
    );
};
