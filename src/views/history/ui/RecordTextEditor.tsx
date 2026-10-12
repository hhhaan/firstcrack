import { useActiveWorkspace } from '@entities/organization';
import { useUpdateRoastSession } from '@entities/roast';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Changes record text only; inventory bean identity and event writes remain separate. */
export const RecordTextEditor = ({ session }: { session: RoastSessionWithRelations }) => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { mutateAsync, isPending } = useUpdateRoastSession(workspaceOwnerId);
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(session.bean_label ?? '');
    const [notes, setNotes] = useState(session.notes ?? '');
    const [error, setError] = useState(false);
    const canWrite = isWorkspaceReady && !!workspaceOwnerId && session.user_id === workspaceOwnerId;
    const start = () => {
        setTitle(session.bean_label ?? '');
        setNotes(session.notes ?? '');
        setError(false);
        setEditing(true);
    };
    const save = async () => {
        if (!canWrite || isPending) return;
        setError(false);
        try {
            await mutateAsync({ id: session.id, bean_label: title.trim() || null, notes: notes.trim() || null });
            setEditing(false);
        } catch {
            setError(true);
        }
    };
    if (!editing)
        return (
            <div className="space-y-3">
                <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-7 text-secondary">
                    {session.notes || t('history.noNotes')}
                </p>
                <button
                    type="button"
                    disabled={!canWrite}
                    onClick={start}
                    data-testid="history-edit-text"
                    className="text-xs text-secondary disabled:opacity-40"
                >
                    {t('history.recordText.edit')}
                </button>
            </div>
        );
    return (
        <div className="space-y-3">
            <label className="block text-xs text-muted">
                {t('history.recordText.title')}
                <input
                    data-testid="history-record-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled={isPending}
                    placeholder={session.beans?.name ?? ''}
                    className="mt-1 w-full rounded border border-border bg-main-bg p-2 text-primary"
                />
            </label>
            <label className="block text-xs text-muted">
                {t('history.expanded.notes')}
                <textarea
                    data-testid="history-record-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    disabled={isPending}
                    rows={5}
                    className="mt-1 w-full rounded border border-border bg-main-bg p-2 text-primary"
                />
            </label>
            {error && (
                <p role="alert" className="text-xs text-error">
                    {t('history.recordText.failed')}
                </p>
            )}
            <div className="flex gap-3">
                <button
                    type="button"
                    data-testid="history-text-save"
                    disabled={isPending || !canWrite}
                    onClick={() => void save()}
                    className="text-xs text-primary disabled:opacity-40"
                >
                    {t('common.save')}
                </button>
                <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setEditing(false)}
                    className="text-xs text-muted"
                >
                    {t('common.cancel')}
                </button>
            </div>
        </div>
    );
};
