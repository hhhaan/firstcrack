import { formErrorCls, inputCls, modalCancelBtnCls, modalPrimaryBtnCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatEditTime, normalizeHeaterPlan, parseEditTime, type ReplayPlanSource } from '../lib/heater-events';
import { eventTrigger, type ReplayEvent, type ReplayPoint, type ReplayTrigger } from '../lib/replay';

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
    onClose: () => void;
    onApply: (events: ReplayEvent[] | null) => void | Promise<void>;
};

const toDisplayBt = (c: number, unit: 'C' | 'F') => (unit === 'F' ? (c * 9) / 5 + 32 : c);
const fromDisplayBt = (v: number, unit: 'C' | 'F') => (unit === 'F' ? ((v - 32) * 5) / 9 : v);

const toDraft = (events: ReplayEvent[], tpTime: number, unit: 'C' | 'F'): DraftRow[] =>
    events.map((e, i) => ({
        key: `${i}-${e.t}-${e.heater}-${e.trigger ?? ''}`,
        t: formatEditTime(e.t),
        bt: String(Math.round(toDisplayBt(e.bt, unit) * 10) / 10),
        heater: String(e.heater),
        trigger: eventTrigger(e, tpTime),
    }));

const parseRows = (rows: DraftRow[], unit: 'C' | 'F'): ReplayEvent[] | null => {
    const events: ReplayEvent[] = [];
    for (const row of rows) {
        const t = parseEditTime(row.t);
        const bt = fromDisplayBt(Number(row.bt), unit);
        const heater = Number(row.heater);
        if (t == null || !Number.isFinite(bt) || !Number.isFinite(heater)) return null;
        events.push({ t, bt, heater, trigger: row.trigger });
    }
    return events;
};

export const HeaterEventsEditor = ({ mode, events, tpTime, btPoints, source, unit, onClose, onApply }: Props) => {
    const { t } = useTranslation();
    const [rows, setRows] = useState<DraftRow[]>(() => toDraft(events, tpTime, unit));
    const [error, setError] = useState<string | null>(null);
    const [ruleBt, setRuleBt] = useState('192');
    const [ruleHeater, setRuleHeater] = useState('50');
    const [selected, setSelected] = useState(0);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopImmediatePropagation();
            onClose();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    const parsed = useMemo(() => parseRows(rows, unit) ?? [], [rows, unit]);

    const update = (key: string, patch: Partial<DraftRow>) => {
        setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
        setError(null);
    };

    const addStep = () => {
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
        const bt = Number(ruleBt);
        const heater = Number(ruleHeater);
        if (!Number.isFinite(bt) || !Number.isFinite(heater)) return;
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
        if (next && next.length > 0 && !normalizeHeaterPlan(next, tpTime)) {
            setError(t('heaterEventsEditor.tooMany'));
            return;
        }
        setBusy(true);
        try {
            await onApply(next && next.length > 0 ? next : null);
        } finally {
            setBusy(false);
        }
    };

    const submit = () => {
        const next = parseRows(rows, unit);
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
            onClose={onClose}
            labelledBy="heater-events-editor-title"
            contentClassName={`${modalPanel.compare} h-[min(620px,calc(100vh-80px))]`}
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
                        onClose={onClose}
                        closeLabel={t('common.close')}
                        className="px-0 pt-0 pb-0"
                    />
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-black/5 px-6 py-2 text-xs text-muted">
                    <span className="inline-flex h-[22px] items-center rounded-full bg-surface px-2 font-semibold text-secondary">
                        {sourceLabel}
                    </span>
                    {source !== 'tsv' && (
                        <button
                            type="button"
                            className="ml-auto cursor-pointer border-none bg-transparent text-xs font-medium text-red-600"
                            onClick={() => void handleApply(null)}
                        >
                            {t('heaterEventsEditor.revert')}
                        </button>
                    )}
                </div>
                <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="min-h-0 border-b border-black/5 p-3 md:border-r md:border-b-0 dark:border-[#585d61]">
                        <HeatStepChart events={parsed} btPoints={btPoints} selected={selected} onSelect={setSelected} />
                    </div>
                    <div className="flex min-h-0 flex-col p-3">
                        <div className="mb-2 flex flex-wrap items-end gap-1.5">
                            <label className="min-w-0 flex-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
                                {t('heaterEventsEditor.ruleWhen')}
                                <input
                                    value={ruleBt}
                                    onChange={(e) => setRuleBt(e.target.value)}
                                    className={`${inputCls} mt-1 py-1.5 text-xs`}
                                    inputMode="decimal"
                                    aria-label={t('heaterEventsEditor.bt')}
                                />
                            </label>
                            <label className="min-w-0 flex-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
                                {t('heaterEventsEditor.ruleThen')}
                                <input
                                    value={ruleHeater}
                                    onChange={(e) => setRuleHeater(e.target.value)}
                                    className={`${inputCls} mt-1 py-1.5 text-xs`}
                                    inputMode="decimal"
                                    aria-label={t('heaterEventsEditor.heat')}
                                />
                            </label>
                            <button
                                type="button"
                                onClick={addBtRule}
                                className="mb-0.5 cursor-pointer rounded-xl border-none bg-surface px-2.5 py-2 text-xs font-medium text-primary"
                            >
                                {t('heaterEventsEditor.ruleAdd')}
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto">
                            <table className="w-full border-collapse text-xs">
                                <thead>
                                    <tr className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                                        <th className="sticky top-0 bg-white pb-2 text-left dark:bg-[#181d21]">
                                            {t('heaterEventsEditor.time')}
                                        </th>
                                        <th className="sticky top-0 bg-white pb-2 text-left dark:bg-[#181d21]">
                                            {t('heaterEventsEditor.bt')}
                                        </th>
                                        <th className="sticky top-0 bg-white pb-2 text-left dark:bg-[#181d21]">
                                            {t('heaterEventsEditor.heat')}
                                        </th>
                                        <th className="sticky top-0 bg-white pb-2 text-left dark:bg-[#181d21]">
                                            {t('heaterEventsEditor.trigger')}
                                        </th>
                                        <th className="sticky top-0 bg-white w-8 pb-2 dark:bg-[#181d21]" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row, i) => (
                                        <tr
                                            key={row.key}
                                            className={i === selected ? 'bg-surface' : undefined}
                                            onClick={() => setSelected(i)}
                                        >
                                            <td className="py-1 pr-1">
                                                <input
                                                    value={row.t}
                                                    onChange={(e) => update(row.key, { t: e.target.value })}
                                                    className={`${inputCls} py-1.5 text-xs`}
                                                    aria-label={t('heaterEventsEditor.time')}
                                                />
                                            </td>
                                            <td className="py-1 pr-1">
                                                <input
                                                    value={row.bt}
                                                    onChange={(e) => update(row.key, { bt: e.target.value })}
                                                    className={`${inputCls} py-1.5 text-xs`}
                                                    inputMode="decimal"
                                                    aria-label={t('heaterEventsEditor.bt')}
                                                />
                                            </td>
                                            <td className="py-1 pr-1">
                                                <input
                                                    value={row.heater}
                                                    onChange={(e) => update(row.key, { heater: e.target.value })}
                                                    className={`${inputCls} py-1.5 text-xs`}
                                                    inputMode="decimal"
                                                    aria-label={t('heaterEventsEditor.heat')}
                                                />
                                            </td>
                                            <td className="py-1 pr-1">
                                                <select
                                                    value={row.trigger}
                                                    onChange={(e) =>
                                                        update(row.key, { trigger: e.target.value as ReplayTrigger })
                                                    }
                                                    className={`${inputCls} appearance-none py-1.5 pr-6 text-xs`}
                                                    aria-label={t('heaterEventsEditor.trigger')}
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
                                                    onClick={() =>
                                                        setRows((prev) => prev.filter((r) => r.key !== row.key))
                                                    }
                                                >
                                                    <Trash2 size={14} strokeWidth={2} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <button
                            type="button"
                            onClick={addStep}
                            className="mt-2 inline-flex cursor-pointer items-center gap-1 border-none bg-transparent text-xs font-medium text-secondary"
                        >
                            <Plus size={14} strokeWidth={2} />
                            {t('heaterEventsEditor.addStep')}
                        </button>
                        {error && <p className={formErrorCls}>{error}</p>}
                    </div>
                </div>
                <div className="flex shrink-0 gap-3 border-t border-black/4 px-6 pt-4 pb-5 dark:border-[#585d61]">
                    <button type="button" onClick={onClose} className={modalCancelBtnCls}>
                        {t('heaterEventsEditor.cancel')}
                    </button>
                    <button type="button" onClick={submit} disabled={busy} className={modalPrimaryBtnCls}>
                        {mode === 'batch' ? t('heaterEventsEditor.applyBatch') : t('heaterEventsEditor.save')}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};

const HeatStepChart = ({
    events,
    btPoints,
    selected,
    onSelect,
}: {
    events: ReplayEvent[];
    btPoints: ReplayPoint[];
    selected: number;
    onSelect: (index: number) => void;
}) => {
    const { t } = useTranslation();
    const width = 640;
    const height = 260;
    const pad = { l: 36, r: 36, t: 16, b: 28 };
    const maxT = Math.max(60, ...btPoints.map((p) => p.t), ...events.map((e) => e.t), 1);
    const bts = btPoints.map((p) => p.bt).filter((n) => Number.isFinite(n));
    const minBt = (bts.length ? Math.min(...bts) : 80) - 10;
    const maxBt = (bts.length ? Math.max(...bts) : 220) + 10;
    const heatMax = Math.max(100, ...events.map((e) => e.heater), 10);
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
        <div className="flex h-full min-h-[220px] flex-col">
            <div className="mb-2 flex gap-3 text-[11px] font-semibold text-muted">
                <span>{t('heaterEventsEditor.chartHeat')}</span>
                <span>{t('heaterEventsEditor.chartBt')}</span>
            </div>
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="h-full w-full"
                role="img"
                aria-label={t('heaterEventsEditor.chartHeat')}
            >
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
                    <circle
                        key={`${e.t}-${e.heater}-${i}`}
                        cx={x(e.t)}
                        cy={yHeat(e.heater)}
                        r={i === selected ? 5 : 3.5}
                        fill={i === selected ? 'var(--color-control-heat)' : '#fff'}
                        stroke="var(--color-control-heat)"
                        strokeWidth="1.5"
                        className="cursor-pointer"
                        onClick={() => onSelect(i)}
                    />
                ))}
            </svg>
        </div>
    );
};
