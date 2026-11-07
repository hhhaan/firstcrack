import { useRoastSettings } from '@features/active-roast/model/settings';
import { feedbackLabel } from '@shared/lib/feedback';
import type { ReadUnits } from '@shared/types/sidecar';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    controlHasRange,
    isBuiltinManualControlId,
    type ManualControlDraft,
    type ManualControlId,
    manualControlsFor,
    noteControlDraft,
} from '../lib/manual-controls';

export type RoastNoteValues = ManualControlDraft & { note: string };

export const emptyNoteValues = (): RoastNoteValues => ({ gas: '', airflow: '', drum: '', note: '', virtual: {} });

export const noteValuesFilled = (values: RoastNoteValues) =>
    [values.gas, values.airflow, values.drum, values.note, ...Object.values(values.virtual)].some((value) =>
        value.trim(),
    );

const labelKey = (id: ManualControlId) => (id === 'drum' ? 'activeRoast.controls.drum' : `activeRoast.noteEntry.${id}`);
const roleFor = { gas: 'heater', airflow: 'fan', drum: 'drum' } as const;

const fitComment = (gas: HTMLInputElement, comment: HTMLTextAreaElement) => {
    comment.style.height = `${gas.offsetHeight}px`;
    if (!comment.value) return;
    const overflow = comment.scrollHeight - comment.clientHeight;
    if (overflow > 0) comment.style.height = `${comment.offsetHeight + overflow}px`;
};

export const RoastNoteFields = ({
    values,
    onChange,
    prefix,
    commentId,
    machineId,
    readUnits,
    onlyIds,
    autoFocus = false,
}: {
    values: RoastNoteValues;
    onChange: (values: RoastNoteValues) => void;
    prefix: string;
    commentId: string;
    machineId?: string | null;
    readUnits?: ReadUnits;
    /** Restricts builtin channels; enabled custom virtual rows remain available. */
    onlyIds?: readonly ManualControlId[];
    autoFocus?: boolean;
}) => {
    const { t } = useTranslation();
    const machineUnits = readUnits && Object.keys(readUnits).length ? readUnits : undefined;
    const controls = manualControlsFor(useRoastSettings(), machineId).filter(
        (control) =>
            control.enabled &&
            (!onlyIds || !isBuiltinManualControlId(control.id) || onlyIds.includes(control.id)) &&
            (!machineUnits ||
                !isBuiltinManualControlId(control.id) ||
                machineUnits[roleFor[control.id]] ||
                values[control.id]),
    );
    const measureRef = useRef<HTMLInputElement>(null);
    const commentRef = useRef<HTMLTextAreaElement>(null);
    const inputClass =
        'min-w-0 w-full rounded border border-(--color-border) bg-transparent px-2 py-1 text-xs text-(--color-text-primary) outline-none placeholder:text-muted/40 focus:border-(--color-primary)';

    const labelFor = (id: string, custom: string) => {
        const name = custom.trim();
        if (name) return name;
        return isBuiltinManualControlId(id) ? t(labelKey(id)) : id;
    };
    const valueFor = (id: string) => (isBuiltinManualControlId(id) ? values[id] : (values.virtual[id] ?? ''));
    const setValue = (id: string, next: string) => {
        if (isBuiltinManualControlId(id)) {
            onChange({ ...values, [id]: next });
            return;
        }
        onChange({ ...values, virtual: { ...values.virtual, [id]: next } });
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies: note changes update the textarea DOM before its height is measured
    useLayoutEffect(() => {
        const measure = measureRef.current;
        const comment = commentRef.current;
        if (!measure || !comment) return;
        fitComment(measure, comment);
    }, [values.note]);

    return (
        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-1 gap-y-1 px-1 text-[11px] text-muted">
            {controls.map((control, index) => {
                const role = isBuiltinManualControlId(control.id) ? roleFor[control.id] : undefined;
                const machineUnit = role ? machineUnits?.[role] : undefined;
                const label =
                    role && machineUnit
                        ? t(
                              `settings.firescope.feedback.${role === 'fan' && machineUnit === 'Pa' ? 'airPressure' : role}`,
                              {
                                  defaultValue: feedbackLabel(role, machineUnits),
                              },
                          )
                        : labelFor(control.id, control.label);
                const ranged = controlHasRange(control.id);
                const unit = machineUnit ?? control.unit.trim();
                const bounds = `${control.min}–${control.max}`;
                return (
                    <label key={control.id} className="contents" htmlFor={`${prefix}-${control.id}`}>
                        <span className="truncate" title={label}>
                            {label}
                        </span>
                        <span className="relative block min-w-0">
                            <input
                                ref={index === 0 ? measureRef : undefined}
                                id={`${prefix}-${control.id}`}
                                autoFocus={autoFocus && index === 0}
                                value={valueFor(control.id)}
                                inputMode={ranged ? 'decimal' : 'text'}
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(event) =>
                                    setValue(
                                        control.id,
                                        ranged ? noteControlDraft(event.target.value) : event.target.value,
                                    )
                                }
                                className={ranged ? `${inputClass} pr-16` : unit ? `${inputClass} pr-8` : inputClass}
                            />
                            {(ranged || unit) && (
                                <span
                                    className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center gap-1 font-inconsolata text-[12px] tabular-nums text-muted"
                                    title={ranged ? (unit ? `${unit} ${bounds}` : bounds) : unit}
                                >
                                    {unit ? <span>{unit}</span> : null}
                                    {ranged && <span>{bounds}</span>}
                                </span>
                            )}
                        </span>
                    </label>
                );
            })}
            <label className="contents" htmlFor={commentId}>
                <span className="truncate">{t('activeRoast.noteEntry.comment')}</span>
                <textarea
                    ref={commentRef}
                    id={commentId}
                    rows={1}
                    value={values.note}
                    placeholder={t('activeRoast.noteEntry.commentPlaceholder')}
                    onChange={(event) => onChange({ ...values, note: event.target.value })}
                    className={`${inputClass} resize-none overflow-hidden`}
                />
            </label>
        </div>
    );
};
