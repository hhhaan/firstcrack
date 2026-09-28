import { type TemperatureUnit, tempUnitLabel } from '@features/active-roast';
import { isDecimalDraft, isPartialTime } from '@features/machine-control/lib/heater-events';
import type { Json } from '@shared/types/database.types';
import { formErrorCls, inputCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyEventDrafts, type EventDraft, type EventDraftError, toEventDrafts } from '../lib/record-edit';

type Props = {
    events: Json;
    unit: TemperatureUnit;
    onSave: (events: Json) => Promise<void>;
    errorText: (error: unknown) => string;
    onClose: () => void;
};

/** Key mark time/temp of a saved record. Rows are fixed — no add/delete; Charge stays at 0:00. */
export const RecordEventsEditor = ({ events, unit, onSave, errorText, onClose }: Props) => {
    const { t } = useTranslation();
    const [drafts, setDrafts] = useState<EventDraft[]>(() => toEventDrafts(events, unit));
    const [errors, setErrors] = useState<Partial<Record<number, EventDraftError>>>({});
    const [saveError, setSaveError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);

    const close = () => {
        if (!inFlight.current) onClose();
    };
    const onEscape = useEffectEvent(close);
    const formRef = useRef<HTMLFormElement>(null);
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
        setDrafts((prev) => prev.map((d) => (d.index === index ? { ...d, ...patch } : d)));
        setErrors(({ [index]: _, ...rest }) => rest);
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
    };

    return (
        <ModalShell
            onClose={close}
            dismissable={false}
            labelledBy="record-events-editor-title"
            contentClassName={modalPanel.formSm}
            data-testid="record-events-editor"
        >
            <form ref={formRef} onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-col">
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
                                </tr>
                            </thead>
                            <tbody>
                                {drafts.map((d) => {
                                    const error = errors[d.index];
                                    const errorId = `record-event-error-${d.index}`;
                                    return (
                                        <tr key={d.index} className="align-top">
                                            <td className="py-1 pt-3 pr-2 text-[13px] font-medium text-primary">
                                                {d.type}
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
                                                    value={d.time}
                                                    readOnly={d.type === 'Charge'}
                                                    title={
                                                        d.type === 'Charge' ? t('history.edit.chargeFixed') : undefined
                                                    }
                                                    onChange={(e) => {
                                                        if (isPartialTime(e.target.value))
                                                            update(d.index, { time: e.target.value });
                                                    }}
                                                    maxLength={6}
                                                    className={`${inputCls} px-2 py-1.5 font-mono text-xs read-only:opacity-60 ${error === 'time' || error === 'order' ? 'border-red-500' : ''}`}
                                                    inputMode="numeric"
                                                    autoComplete="off"
                                                    aria-label={`${d.type} ${t('history.edit.time')}`}
                                                    aria-invalid={error === 'time' || error === 'order'}
                                                    aria-describedby={error ? errorId : undefined}
                                                />
                                            </td>
                                            <td className="px-1 py-1">
                                                <input
                                                    value={d.temp}
                                                    onChange={(e) => {
                                                        if (isDecimalDraft(e.target.value, 1))
                                                            update(d.index, { temp: e.target.value });
                                                    }}
                                                    maxLength={5}
                                                    className={`${inputCls} px-2 py-1.5 font-mono text-xs ${error === 'temp' ? 'border-red-500' : ''}`}
                                                    inputMode="decimal"
                                                    autoComplete="off"
                                                    aria-label={`${d.type} ${t('history.edit.temp')}`}
                                                    aria-invalid={error === 'temp'}
                                                    aria-describedby={error ? errorId : undefined}
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
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
