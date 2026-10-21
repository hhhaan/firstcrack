import { useActiveWorkspace } from '@entities/organization';
import { useUpdateRoastSession } from '@entities/roast';
import { formatDateTimeShort } from '@shared/lib/format';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const titleCls =
    'm-0 w-full min-w-0 break-words border-0 bg-transparent p-0 text-left font-(--font-display) text-[24px] leading-tight tracking-[-0.5px] text-primary outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--color-primary)';

/** Session display title (`batch_name`). Does not rename the inventory bean. */
export const RecordTitleEditor = ({ session }: { session: RoastSessionWithRelations }) => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { mutateAsync, isPending } = useUpdateRoastSession(workspaceOwnerId);
    const inventoryName = session.beans?.name?.trim() || null;
    const stored = session.batch_name?.trim() || null;
    const dateLabel = formatDateTimeShort(session.roasted_at);
    const fallback = session.bean_label?.trim() || inventoryName || dateLabel;
    const displayed = stored || fallback;
    const canWrite = isWorkspaceReady && !!workspaceOwnerId && session.user_id === workspaceOwnerId;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(displayed);
    const [error, setError] = useState(false);
    const skipSave = useRef(false);
    const saving = useRef(false);

    const start = () => {
        if (!canWrite || isPending) return;
        setDraft(displayed);
        setError(false);
        setEditing(true);
    };

    const commit = async () => {
        if (skipSave.current) {
            skipSave.current = false;
            return;
        }
        if (!canWrite || isPending || saving.current) return;
        const next = draft.trim();
        // Title is an independent field: store the typed value verbatim (empty clears it).
        const nextLabel = next || null;
        const unchanged = nextLabel === stored || (stored === null && next === fallback);
        if (unchanged) {
            setError(false);
            setEditing(false);
            return;
        }
        setError(false);
        saving.current = true;
        try {
            await mutateAsync({ id: session.id, batch_name: nextLabel });
            setEditing(false);
        } catch {
            setError(true);
        } finally {
            saving.current = false;
        }
    };

    const cancel = () => {
        skipSave.current = true;
        setDraft(displayed);
        setError(false);
        setEditing(false);
    };

    const title = editing ? (
        <input
            data-testid="history-record-title"
            aria-label={t('history.recordText.title')}
            value={draft}
            maxLength={120}
            placeholder={inventoryName || dateLabel}
            disabled={isPending}
            autoFocus
            onChange={(event) => {
                setDraft(event.target.value);
                setError(false);
            }}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cancel();
                }
            }}
            className={`${titleCls} border-b border-border`}
        />
    ) : canWrite ? (
        <button
            type="button"
            data-testid="history-record-title"
            title={t('history.recordText.title')}
            onClick={start}
            className={`${titleCls} cursor-text`}
        >
            <span className="underline decoration-border decoration-1 underline-offset-[7px] hover:decoration-primary">
                {displayed}
            </span>
        </button>
    ) : (
        <span className={titleCls}>{displayed}</span>
    );

    return (
        <div className="min-w-0">
            <p className="m-0 mb-1 text-[11px] font-medium text-muted">{t('history.recordText.title')}</p>
            <h1 className="m-0">{title}</h1>
            {error && (
                <p role="alert" className="mt-1 text-xs text-error">
                    {t('history.recordText.failed')}
                </p>
            )}
        </div>
    );
};
