import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoastTitleEdit } from '../model/useRoastTitleEdit';

const titleCls =
    'm-0 min-w-0 border-0 bg-transparent p-0 text-left font-(--font-display) text-[28px] leading-[1.13] tracking-[-0.4px] text-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--color-primary)';

export const RoastTitleEditor = ({ sessionId, title }: { sessionId: string; title: string }) => {
    const { t } = useTranslation();
    const { editableTitle, canWrite, save } = useRoastTitleEdit(sessionId, title);
    const [draft, setDraft] = useState<string | null>(null);
    const dirty = useRef(false);

    if (!canWrite) return <span className={titleCls}>{title}</span>;

    return draft !== null ? (
        <input
            aria-label={t('activeRoast.header.batchTitle')}
            value={draft}
            maxLength={120}
            autoFocus
            onChange={(event) => {
                dirty.current = true;
                setDraft(event.target.value);
            }}
            onBlur={() => {
                if (dirty.current && draft.trim() !== editableTitle) save(draft);
                dirty.current = false;
                setDraft(null);
            }}
            onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    dirty.current = false;
                    setDraft(null);
                }
            }}
            className={`${titleCls} w-full border-b border-border`}
        />
    ) : (
        <button
            type="button"
            title={t('activeRoast.header.batchTitle')}
            onClick={() => {
                dirty.current = false;
                setDraft(editableTitle);
            }}
            className={`${titleCls} cursor-text`}
        >
            <span className="underline decoration-border decoration-1 underline-offset-[7px] hover:decoration-primary">
                {title}
            </span>
        </button>
    );
};
