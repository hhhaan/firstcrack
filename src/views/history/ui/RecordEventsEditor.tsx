import { type TemperatureUnit, tempUnitLabel, useRoastSettings } from '@features/active-roast';
import { isCustomRoastEvent } from '@features/active-roast/lib/event-buttons';
import { isDecimalDraft, isPartialTime } from '@features/machine-control/lib/heater-events';
import { roastEventLabel } from '@shared/i18n/roast-event-label';
import { useTimeEditRoot } from '@shared/lib/useTimeEditRoot';
import type { Json } from '@shared/types/database.types';
import { FormSelect } from '@shared/ui/FormSelect';
import { formErrorCls, inputCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ADDABLE_KEY_EVENTS,
    applyEventDrafts,
    compareEventDrafts,
    type EventDraft,
    type EventDraftError,
    nextAddableEvent,
    toEventDrafts,
} from '../lib/record-edit';

const freshIndex = (rows: EventDraft[]) => Math.min(0, ...rows.map((d) => d.index)) - 1;

type Props = {
    events: Json;
    unit: TemperatureUnit;
    onSave: (events: Json) => Promise<void>;
    errorText: (error: unknown) => string;
    onClose: () => void;
};

/** Key mark time/temp of a saved record. Missing TP/Yellow/FC marks can be added. Charge and Drop stay as saved. */
export const RecordEventsEditor = ({ events, unit, onSave, errorText, onClose }: Props) => {
    const { t } = useTranslation();
    const [drafts, setDrafts] = useState<EventDraft[]>(() => toEventDrafts(events, unit));
    const [errors, setErrors] = useState<Partial<Record<number, EventDraftError>>>({});
    const [saveError, setSaveError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);

    const setTimeRoot = useTimeEditRoot((key, value) => {
        const index = Number(key);
        setDrafts((prev) => prev.map((row) => (row.index === index ? { ...row, time: value } : row)));
        setErrors(({ [index]: _, ...rest }) => rest);
        setSaveError(null);
    });
    const close = () => {
        if (!inFlight.current) onClose();
    };
    const onEscape = useEffectEvent(close);
    const formRef = useRef<HTMLFormElement>(null);
    const bindForm = useCallback(
        (node: HTMLFormElement | null) => {
            formRef.current = node;
            setTimeRoot(node);
        },
        [setTimeRoot],
    );
    useEffect(() => {
        formRef.current?.querySelector<HTMLInputElement>('input:not([readonly])')?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopImmediatePropagation();
            onEscape();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, []);

    const update = (index: number, patch: Partial<EventDraft>) => {
        setDrafts((prev) => {
            const next = prev.map((d) => (d.index === index ? { ...d, ...patch } : d));
            return patch.type ? [...next].sort(compareEventDrafts) : next;
        });
        setErrors(({ [index]: _, ...rest }) => rest);
        setSaveError(null);
    };

    const remove = (index: number) => {
        setDrafts((prev) => prev.filter((row) => row.index !== index));
        setErrors(({ [index]: _, ...rest }) => rest);
        setSaveError(null);
    };

    const configuredCustom = useRoastSettings().eventButtons.custom.map((row) => row.name.trim());
    const customNames = [
        ...new Set([...configuredCustom, ...drafts.map((row) => row.type)].filter((name) => isCustomRoastEvent(name))),
    ];
    const addEvent = () => {
        setDrafts((prev) => {
            const names = [
                ...new Set(
                    [...configuredCustom, ...prev.map((row) => row.type)].filter((name) => isCustomRoastEvent(name)),
                ),
            ];
            const type = nextAddableEvent(prev.map((row) => row.type)) ?? names[0];
            if (!type) return prev;
            return [...prev, { index: freshIndex(prev), type, time: '', temp: '' }].sort(compareEventDrafts);
        });
        setSaveError(null);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        // State lags a same-tick double submit; the ref blocks the second write.
        if (inFlight.current) return;
        const res = applyEventDrafts(events, drafts, unit);
        if (!res.ok) {
            setErrors(res.errors);
            return;
        }
        if (!res.changed) {
            onClose();
            return;
        }
        inFlight.current = true;
        setBusy(true);
        try {
            await onSave(res.events);
            onClose();
        } catch (err) {
            setSaveError(errorText(err));
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };

    const errorKey: Record<EventDraftError, string> = {
        time: 'history.edit.invalidTime',
        temp: 'history.edit.invalidTemp',
        order: 'history.edit.invalidOrder',
        duplicate: 'history.edit.duplicate',
    };
    const canAdd = nextAddableEvent(drafts.map((d) => d.type)) != null || customNames.length > 0;

    return (
        <ModalShell
            onClose={close}
            dismissable={false}
            labelledBy="record-events-editor-title"
            contentClassName={modalPanel.formSm}
            data-testid="record-events-editor"
        >
            <form ref={bindForm} onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-col">
                <div className="shrink-0 border-b border-border-subtle px-7 py-5">
                    <ModalHeader
                        titleId="record-events-editor-title"
                        title={t('history.edit.eventsTitle')}
                        subtitle={<p className="mt-1 text-sm text-secondary">{t('history.edit.eventsHint')}</p>}
                        onClose={close}
                        closeLabel={t('common.close')}
                    />
                </div>
                <fieldset disabled={busy} className="m-0 min-h-0 flex-1 overflow-y-auto border-0 px-7 py-4">
                    {drafts.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted">{t('history.edit.noEvents')}</p>
                    ) : (
                        <table className="w-full table-fixed border-separate border-spacing-y-1.5 text-xs">
                            <thead>
                                <tr className="text-left text-[11px] font-semibold text-muted">
                                    <th className="pb-1">{t('history.edit.event')}</th>
                                    <th className="w-24 px-1 pb-1">{t('history.edit.time')} (m:ss)</th>
                                    <th className="w-28 px-1 pb-1">
                                        {t('history.edit.temp')} ({tempUnitLabel(unit)})
                                    </th>
                                    <th className="w-8 pb-1" />
                                </tr>
                            </thead>
                            <tbody>
                                {drafts.map((d) => {
                                    const error = errors[d.index];
                                    const errorId = `record-event-error-${d.index}`;
                                    const added = d.index < 0;
                                    const fixed = d.type === 'Charge' || d.type === 'Drop';
                                    const taken = new Set(
                                        drafts.filter((row) => row.index !== d.index).map((row) => row.type),
                                    );
                                    const typeOptions = [
                                        ...ADDABLE_KEY_EVENTS.filter((type) => type === d.type || !taken.has(type)),
                                        ...customNames,
                                    ];
                                    return (
                                        <tr key={d.index} className="align-top">
                                            <td className="py-1 pr-2 text-[13px] font-medium text-primary">
                                                {added ? (
                                                    <FormSelect
                                                        value={d.type}
                                                        onChange={(e) => update(d.index, { type: e.target.value })}
                                                        aria-label={`${d.type} ${t('history.edit.eventType')}`}
                                                        aria-invalid={error === 'duplicate'}
                                                        aria-describedby={error ? errorId : undefined}
                                                        className="py-1.5 pl-2 pr-8 text-xs"
                                                    >
                                                        {typeOptions.map((type) => (
                                                            <option key={type} value={type}>
                                                                {roastEventLabel(type)}
                                                            </option>
                                                        ))}
                                                    </FormSelect>
                                                ) : (
                                                    <span className="inline-block pt-2">{roastEventLabel(d.type)}</span>
                                                )}
                                                {error && (
                                                    <p
                                                        id={errorId}
                                                        role="alert"
                                                        className={`${formErrorCls} font-normal`}
                                                    >
                                                        {t(errorKey[error])}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="px-1 py-1">
                                                <input
                                                    data-time-key={d.index}
                                                    value={d.time}
                                                    readOnly={fixed}
                                                    title={fixed ? t('history.edit.chargeFixed') : undefined}
                                                    onChange={(e) => {
                                                        if (fixed || !isPartialTime(e.target.value)) {
                                                            e.target.value = d.time;
                                                            return;
                                                        }
                                                        update(d.index, { time: e.target.value });
                                                    }}
                                                    maxLength={6}
                                                    className={`${inputCls} px-2 py-1.5 font-mono text-xs read-only:opacity-60 ${error === 'time' || error === 'order' ? 'border-red-500' : ''}`}
                                                    inputMode="numeric"
                                                    autoComplete="off"
                                                    aria-label={`${roastEventLabel(d.type)} ${t('history.edit.time')}`}
                                                    aria-invalid={error === 'time' || error === 'order'}
                                                    aria-describedby={error ? errorId : undefined}
                                                />
                                            </td>
                                            <td className="px-1 py-1">
                                                <input
                                                    value={d.temp}
                                                    readOnly={fixed}
                                                    title={fixed ? t('history.edit.chargeFixed') : undefined}
                                                    onChange={(e) => {
                                                        if (fixed || !isDecimalDraft(e.target.value, 1)) {
                                                            e.target.value = d.temp;
                                                            return;
                                                        }
                                                        update(d.index, { temp: e.target.value });
                                                    }}
                                                    maxLength={5}
                                                    className={`${inputCls} px-2 py-1.5 font-mono text-xs read-only:opacity-60 ${error === 'temp' ? 'border-red-500' : ''}`}
                                                    inputMode="decimal"
                                                    autoComplete="off"
                                                    aria-label={`${roastEventLabel(d.type)} ${t('history.edit.temp')}`}
                                                    aria-invalid={error === 'temp'}
                                                    aria-describedby={error ? errorId : undefined}
                                                />
                                            </td>
                                            <td className="py-1 pl-1">
                                                {!fixed && (
                                                    <button
                                                        type="button"
                                                        aria-label={`${roastEventLabel(d.type)} ${t('common.delete')}`}
                                                        onClick={() => remove(d.index)}
                                                        className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg border-none bg-transparent text-muted hover:bg-surface hover:text-red-600"
                                                    >
                                                        <Trash2 size={14} strokeWidth={2} />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                    {canAdd && (
                        <button
                            type="button"
                            data-testid="record-events-add"
                            onClick={addEvent}
                            className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-xs font-semibold text-secondary dark:bg-surface-elevated"
                        >
                            <Plus size={13} strokeWidth={2} />
                            {t('history.edit.addEvent')}
                        </button>
                    )}
                </fieldset>
                {saveError && (
                    <p role="alert" className={`${formErrorCls} shrink-0 px-7 pb-2`}>
                        {saveError}
                    </p>
                )}
                <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-7 py-4">
                    <button
                        type="button"
                        onClick={close}
                        disabled={busy}
                        className="min-w-24 cursor-pointer rounded-xl border-none bg-surface px-5 py-2.5 text-sm font-semibold text-secondary disabled:opacity-50 dark:bg-surface-elevated"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        disabled={busy || drafts.length === 0}
                        className="cursor-pointer rounded-xl border-none bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-black"
                    >
                        {busy ? t('history.edit.saving') : t('history.edit.save')}
                    </button>
                </div>
            </form>
        </ModalShell>
    );
};
