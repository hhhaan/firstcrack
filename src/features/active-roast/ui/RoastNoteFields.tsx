import { useRoastSettings } from '@features/active-roast/model/settings';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type ManualControlId, noteControlDraft } from '../lib/manual-controls';

export type RoastNoteValues = { gas: string; airflow: string; drum: string; note: string };

const labelKey = (id: ManualControlId) => (id === 'drum' ? 'activeRoast.controls.drum' : `activeRoast.noteEntry.${id}`);

const fitComment = (gas: HTMLInputElement, comment: HTMLTextAreaElement) => {
    comment.style.height = `${gas.offsetHeight}px`;
    const overflow = comment.scrollHeight - comment.clientHeight;
    if (overflow > 0) comment.style.height = `${comment.offsetHeight + overflow}px`;
};

export const RoastNoteFields = ({
    values,
    onChange,
    prefix,
    commentId,
    autoFocus = false,
}: {
    values: RoastNoteValues;
    onChange: (values: RoastNoteValues) => void;
    prefix: string;
    commentId: string;
    autoFocus?: boolean;
}) => {
    const { t } = useTranslation();
    const controls = useRoastSettings().manualControls.filter((control) => control.enabled);
    const measureRef = useRef<HTMLInputElement>(null);
    const commentRef = useRef<HTMLTextAreaElement>(null);
    const inputClass =
        'min-w-0 w-full rounded border border-(--color-border) bg-transparent px-2 py-1 text-xs text-(--color-text-primary) outline-none placeholder:text-muted/40 focus:border-(--color-primary)';

    // biome-ignore lint/correctness/useExhaustiveDependencies: note changes update the textarea DOM before its height is measured
    useLayoutEffect(() => {
        const measure = measureRef.current;
        const comment = commentRef.current;
        if (!measure || !comment) return;
        fitComment(measure, comment);
    }, [values.note]);

    return (
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1 gap-y-1 px-1 text-[11px] text-muted">
            {controls.map((control, index) => {
                const label = control.label.trim() || t(labelKey(control.id));
                const unit = control.unit.trim();
                return (
                    <label key={control.id} className="contents" htmlFor={`${prefix}-${control.id}`}>
                        <span className="max-w-24 truncate" title={label}>
                            {label}
                        </span>
                        <input
                            ref={index === 0 ? measureRef : undefined}
                            id={`${prefix}-${control.id}`}
                            autoFocus={autoFocus && index === 0}
                            value={values[control.id]}
                            placeholder={t(`activeRoast.noteEntry.${control.id}Placeholder`)}
                            inputMode="decimal"
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(event) =>
                                onChange({ ...values, [control.id]: noteControlDraft(event.target.value) })
                            }
                            className={inputClass}
                        />
                        <span className="min-w-4 font-mono text-[11px] whitespace-nowrap">{unit}</span>
                    </label>
                );
            })}
            <label className="contents" htmlFor={commentId}>
                <span>{t('activeRoast.noteEntry.comment')}</span>
                <textarea
                    ref={commentRef}
                    id={commentId}
                    rows={1}
                    value={values.note}
                    placeholder={t('activeRoast.noteEntry.commentPlaceholder')}
                    onChange={(event) => onChange({ ...values, note: event.target.value })}
                    className={`${inputClass} resize-none overflow-hidden`}
                />
                <span />
            </label>
        </div>
    );
};
