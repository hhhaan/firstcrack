import { useTranslation } from 'react-i18next';

export type RoastNoteValues = { gas: string; airflow: string; note: string };

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
    const inputClass =
        'min-w-0 w-full rounded border border-(--color-border) bg-(--color-main-bg) px-2.5 py-2 text-[13px] text-(--color-text-primary) outline-none focus:border-(--color-primary)';
    return (
        <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-2 gap-y-2 text-[13px] text-(--color-text-primary)">
            {(['gas', 'airflow'] as const).map((field) => (
                <label key={field} className="contents" htmlFor={`${prefix}-${field}`}>
                    <span>{t(`activeRoast.noteEntry.${field}`)}</span>
                    <input
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
                    id={commentId}
                    rows={1}
                    value={values.note}
                    placeholder={t('activeRoast.noteEntry.commentPlaceholder')}
                    onChange={(event) => onChange({ ...values, note: event.target.value })}
                    className={`${inputClass} resize-y`}
                />
            </label>
        </div>
    );
};
