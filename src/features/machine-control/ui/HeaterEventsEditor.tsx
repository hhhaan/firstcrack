import { formErrorCls, inputCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    BT_DECIMALS,
    formatEditTime,
    HEAT_DECIMALS,
    type HeaterBounds,
    type HeaterDraftIssue,
    heaterFitsBounds,
    isDecimalDraft,
    issueForHeaterEvents,
    parseFiniteNumber,
    type ReplayPlanSource,
    toDisplayBt,
    validateHeaterDraft,
} from '../lib/heater-events';
import { eventTrigger, MAX_EVENTS, type ReplayEvent, type ReplayPoint } from '../lib/replay';
import { type DraftRow, HeaterEventsTable } from './HeaterEventsTable';
import { HeatStepChart } from './HeatStepChart';

/** Saved records, profiles, and batches share add, edit, and delete. History never sends a machine command. */
export type HeaterEventsEditorMode = 'profile' | 'batch' | 'history';

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
    /** Maps an onApply rejection to a message; default is the generic save failure. */
    saveErrorMessage?: (error: unknown) => string | null;
    onClose: () => void;
    onApply: (events: ReplayEvent[] | null) => void | Promise<void>;
};

const toDraft = (events: ReplayEvent[], tpTime: number, unit: 'C' | 'F'): DraftRow[] =>
    events.map((e, i) => ({
        key: e.id ?? `${i}-${e.t}-${e.heater}-${e.trigger ?? ''}`,
        t: formatEditTime(e.t),
        bt: String(Math.round(toDisplayBt(e.bt, unit) * 10) / 10),
        heater: String(e.heater),
        trigger: eventTrigger(e, tpTime),
        referenceT: e.t,
        referenceBt: e.bt,
    }));

const draftInputs = (rows: DraftRow[]) => rows.map((row) => ({ ...row, id: row.key }));

const invalidField = (issue: HeaterDraftIssue): 'time' | 'bt' | 'heat' | null => {
    if (issue.code === 'time') return 'time';
    if (issue.code === 'bt') return 'bt';
    if (issue.code === 'heat-empty' || issue.code === 'heat-range' || issue.code === 'heat-step') return 'heat';
    return null;
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
    saveErrorMessage,
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
    const [invalidCell, setInvalidCell] = useState<{ row: number; field: 'time' | 'bt' | 'heat' } | null>(null);
    const [ruleBt, setRuleBt] = useState(() => String(toDisplayBt(192, unit)));
    const [ruleHeater, setRuleHeater] = useState('50');
    const [selected, setSelected] = useState(0);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);

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

    const parsed = useMemo(() => {
        const draft = validateHeaterDraft(draftInputs(rows), unit, heaterBounds);
        return draft.ok ? draft.events : [];
    }, [rows, unit, heaterBounds]);

    const clearError = () => {
        setError(null);
        setInvalidCell(null);
    };

    const issueText = (issue: HeaterDraftIssue): string => {
        if (issue.code === 'time') return t('heaterEventsEditor.timeInvalid', { row: issue.row });
        if (issue.code === 'bt') return t('heaterEventsEditor.btInvalid', { row: issue.row });
        if (issue.code === 'heat-empty') return t('heaterEventsEditor.heatEmpty', { row: issue.row });
        if (issue.code === 'heat-range') {
            return t('heaterEventsEditor.heatRange', {
                row: issue.row,
                min: heaterBounds.min,
                max: heaterBounds.max,
                unit: heaterUnit,
            });
        }
        if (issue.code === 'heat-step') {
            return t('heaterEventsEditor.heatStep', { row: issue.row, step: heaterBounds.step, unit: heaterUnit });
        }
        return t('heaterEventsEditor.tooMany');
    };

    const showIssue = (issue: HeaterDraftIssue) => {
        const field = invalidField(issue);
        setInvalidCell(field && 'row' in issue ? { row: issue.row, field } : null);
        setError(issueText(issue));
    };

    const update = (key: string, patch: Partial<DraftRow>) => {
        setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
        clearError();
    };

    const addBtRule = () => {
        const bt = parseFiniteNumber(ruleBt);
        const heater = parseFiniteNumber(ruleHeater);
        if (bt == null) {
            setInvalidCell(null);
            setError(t('heaterEventsEditor.ruleBt'));
            return;
        }
        if (heater == null) {
            setInvalidCell(null);
            setError(t('heaterEventsEditor.ruleHeatEmpty'));
            return;
        }
        if (heater < heaterBounds.min || heater > heaterBounds.max) {
            setInvalidCell(null);
            setError(
                t('heaterEventsEditor.ruleHeatRange', {
                    min: heaterBounds.min,
                    max: heaterBounds.max,
                    unit: heaterUnit,
                }),
            );
            return;
        }
        if (!heaterFitsBounds(heater, heaterBounds)) {
            setInvalidCell(null);
            setError(t('heaterEventsEditor.ruleHeatStep', { step: heaterBounds.step, unit: heaterUnit }));
            return;
        }
        setSelected(rows.length);
        setRows((prev) => [
            ...prev,
            {
                key: `bt-${Date.now()}`,
                t: formatEditTime(parsed[parsed.length - 1]?.t ?? 0),
                referenceT: parsed[parsed.length - 1]?.t ?? 0,
                bt: String(bt),
                heater: String(heater),
                trigger: 'bt',
            },
        ]);
        clearError();
    };

    const handleApply = async (next: ReplayEvent[] | null) => {
        if (next && next.length > 0) {
            const issue = issueForHeaterEvents(next, heaterBounds);
            if (issue) {
                showIssue(issue);
                return;
            }
        }
        // State lags a same-tick double click; the ref blocks the second write.
        if (inFlight.current) return;
        inFlight.current = true;
        clearError();
        setBusy(true);
        try {
            await onApply(next && next.length > 0 ? next : null);
        } catch (err) {
            setError(saveErrorMessage?.(err) ?? t('heaterEventsEditor.saveFailed'));
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };

    const submit = () => {
        const draft = validateHeaterDraft(draftInputs(rows), unit, heaterBounds);
        if (!draft.ok) {
            showIssue(draft.issue);
            return;
        }
        void handleApply(draft.events);
    };

    const sourceLabel =
        mode === 'profile' || source === 'profile'
            ? t('heaterEventsEditor.sourceProfile')
            : source === 'batch'
              ? t('heaterEventsEditor.sourceBatch')
              : source === 'session'
                ? t('heaterEventsEditor.sourceSession')
                : t('heaterEventsEditor.sourceTsv');
    const canRevert = mode !== 'profile' && source != null && source !== 'tsv';

    return (
        <ModalShell
            onClose={() => {
                if (!busy) onClose();
            }}
            dismissable={false}
            labelledBy="heater-events-editor-title"
            contentClassName={`${modalPanel.compare} !h-[min(760px,calc(100dvh-48px))]`}
            // 집중 모드 차트는 z-9999. 포털이 그보다 낮으면 편집창이 차트 뒤에 남는다.
            overlayClassName="!z-[10000]"
            data-testid="heater-events-editor"
        >
            <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-border-subtle px-7 py-5">
                    <ModalHeader
                        titleId="heater-events-editor-title"
                        title={t('heaterEventsEditor.title')}
                        subtitle={
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-secondary">
                                <span>
                                    {mode === 'batch'
                                        ? t('heaterEventsEditor.subtitleBatch')
                                        : mode === 'history'
                                          ? t('heaterEventsEditor.subtitleHistory')
                                          : t('heaterEventsEditor.subtitleProfile')}
                                </span>
                                <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold">
                                    {sourceLabel}
                                </span>
                                {boundsNote && <span className="text-xs text-muted">{boundsNote}</span>}
                                {canRevert && (
                                    <button
                                        type="button"
                                        className="cursor-pointer border-none bg-transparent text-xs font-medium text-red-600"
                                        disabled={busy}
                                        onClick={() => void handleApply(null)}
                                    >
                                        {t('heaterEventsEditor.revert')}
                                    </button>
                                )}
                            </div>
                        }
                        onClose={() => {
                            if (!busy) onClose();
                        }}
                        closeLabel={t('common.close')}
                    />
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(420px,1fr)] lg:overflow-hidden">
                    <section className="flex min-h-[500px] min-w-0 flex-col gap-3 overflow-y-auto border-b border-border-subtle px-7 py-5 lg:min-h-0 lg:border-r lg:border-b-0">
                        <h3 className="m-0 text-sm font-semibold text-primary">{t('heaterEventsEditor.chartTitle')}</h3>
                        <div className="h-[270px] shrink-0">
                            <HeatStepChart
                                events={parsed}
                                tpTime={tpTime}
                                btPoints={btPoints}
                                unit={unit}
                                heaterUnit={heaterUnit}
                                heaterMax={heaterBounds.max}
                                selected={selected}
                                onSelect={setSelected}
                            />
                        </div>
                        <p className="m-0 text-xs text-muted">{t('heaterEventsEditor.chartHint')}</p>
                        {rows[selected] && (
                            <div className="w-fit rounded-lg border border-border bg-main-bg px-3 py-2 text-xs text-secondary shadow-(--shadow-elevation)">
                                <span className="font-semibold text-primary">
                                    #{String(selected + 1).padStart(2, '0')}
                                </span>
                                {' · '}
                                {rows[selected].trigger === 'time'
                                    ? `${t('heaterEventsEditor.conditionTime')} ${rows[selected].t}`
                                    : `${t('heaterEventsEditor.conditionBt')} ${rows[selected].bt}°${unit}`}
                                {' · '}
                                {t('heaterEventsEditor.heat')} {rows[selected].heater}
                                {heaterUnit}
                            </div>
                        )}
                        <fieldset
                            disabled={busy}
                            aria-labelledby="heater-events-rule-title"
                            className="m-0 mt-auto min-w-0 rounded-xl border border-border-subtle bg-surface-warm-solid p-4"
                        >
                            <h3 id="heater-events-rule-title" className="m-0 text-sm font-semibold text-primary">
                                {t('heaterEventsEditor.ruleTitle')}
                            </h3>
                            <p className="mt-1 mb-3 text-xs text-muted">{t('heaterEventsEditor.ruleHint')}</p>
                            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                                <label className="min-w-0 text-[11px] font-semibold text-muted">
                                    {t('heaterEventsEditor.ruleWhen')} (°{unit})
                                    <input
                                        value={ruleBt}
                                        onChange={(e) => {
                                            if (isDecimalDraft(e.target.value, BT_DECIMALS)) setRuleBt(e.target.value);
                                        }}
                                        className={`${inputCls} mt-1 py-2 text-xs`}
                                        inputMode="decimal"
                                        aria-label={t('heaterEventsEditor.bt')}
                                    />
                                </label>
                                <label className="min-w-0 text-[11px] font-semibold text-muted">
                                    {t('heaterEventsEditor.ruleThen')} ({heaterUnit})
                                    <input
                                        value={ruleHeater}
                                        onChange={(e) => {
                                            if (isDecimalDraft(e.target.value, HEAT_DECIMALS, heaterBounds.min < 0))
                                                setRuleHeater(e.target.value);
                                        }}
                                        className={`${inputCls} mt-1 py-2 text-xs`}
                                        inputMode="decimal"
                                        aria-label={t('heaterEventsEditor.heat')}
                                    />
                                </label>
                                <button
                                    type="button"
                                    disabled={rows.length >= MAX_EVENTS}
                                    onClick={addBtRule}
                                    className="cursor-pointer rounded-xl border-none bg-primary px-3 py-2.5 text-xs font-semibold whitespace-nowrap text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-black"
                                >
                                    {t('heaterEventsEditor.ruleAdd')}
                                </button>
                            </div>
                        </fieldset>
                    </section>
                    <HeaterEventsTable
                        unit={unit}
                        heaterUnit={heaterUnit}
                        busy={busy}
                        rows={rows}
                        selected={selected}
                        lockedCount={lockedCount}
                        invalidCell={invalidCell}
                        allowNegativeHeat={heaterBounds.min < 0}
                        onSelect={setSelected}
                        onUpdate={update}
                        onDelete={(key) => setRows((prev) => prev.filter((row) => row.key !== key))}
                    />
                </div>
                {error && (
                    <p role="alert" className={`${formErrorCls} shrink-0 px-7 pb-2`}>
                        {error}
                    </p>
                )}
                <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-7 py-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="min-w-24 cursor-pointer rounded-xl border-none bg-surface px-5 py-2.5 text-sm font-semibold text-secondary disabled:opacity-50 dark:bg-surface-elevated"
                    >
                        {t('heaterEventsEditor.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={busy}
                        className="cursor-pointer rounded-xl border-none bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-black"
                    >
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
