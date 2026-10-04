import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export type RoastNoteValues = { gas: string; airflow: string; note: string };

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
    const gasRef = useRef<HTMLInputElement>(null);
    const commentRef = useRef<HTMLTextAreaElement>(null);
    const inputClass =
        'min-w-0 w-full rounded border border-(--color-border) bg-transparent px-2 py-1 text-xs text-(--color-text-primary) outline-none focus:border-(--color-primary)';

    // biome-ignore lint/correctness/useExhaustiveDependencies: note changes update the textarea DOM before its height is measured
    useLayoutEffect(() => {
        const gas = gasRef.current;
        const comment = commentRef.current;
        if (!gas || !comment) return;
        fitComment(gas, comment);
    }, [values.note]);

    return (
        <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-x-1 gap-y-1 px-1 text-[11px] text-muted">
            {(['gas', 'airflow'] as const).map((field) => (
                <label key={field} className="contents" htmlFor={`${prefix}-${field}`}>
                    <span>{t(`activeRoast.noteEntry.${field}`)}</span>
                    <input
                        ref={field === 'gas' ? gasRef : undefined}
                        id={`${prefix}-${field}`}
                        autoFocus={autoFocus && field === 'gas'}
                        value={values[field]}
                        placeholder={t(`activeRoast.noteEntry.${field}Placeholder`)}
                        onChange={(event) => onChange({ ...values, [field]: event.target.value })}
                        className={inputClass}
                    />
                </label>
            ))}
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
            </label>
        </div>
    );
};
