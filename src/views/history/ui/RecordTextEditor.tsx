import { useActiveWorkspace } from '@entities/organization';
import { useUpdateRoastSession } from '@entities/roast';
import { formatRoastNote } from '@features/active-roast/lib/roast-note';
import { commitEditTime, isPartialTime, parseEditTime } from '@shared/lib/time-edit';
import { useTimeEditRoot } from '@shared/lib/useTimeEditRoot';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoastRecordSave } from '../hooks/useRoastRecordSave';
import { insertRecordedNote, recordedNotes, removeRecordedNote, updateRecordedNote } from '../lib/recorded-notes';

/** Session summary note, plus the notes recorded on the roast log. */
export const RecordTextEditor = ({ session }: { session: RoastSessionWithRelations }) => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { mutateAsync, isPending: summaryPending } = useUpdateRoastSession(workspaceOwnerId);
    const record = useRoastRecordSave(session);
    const stored = session.notes ?? '';
    const logged = useMemo(() => recordedNotes(session.events), [session.events]);
    const [notes, setNotes] = useState(stored);
    const [drafts, setDrafts] = useState<Record<number, { time: string; comment: string }>>({});
    const [addTime, setAddTime] = useState('');
    const [addComment, setAddComment] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [timeError, setTimeError] = useState<number | 'new' | null>(null);
    const setTimeRoot = useTimeEditRoot((key, value) => {
        setTimeError((current) => (current === (key === 'new' ? 'new' : Number(key)) ? null : current));
        if (key === 'new') {
            setAddTime(value);
            return;
        }
        const index = Number(key);
        setDrafts((prev) => ({
            ...prev,
            [index]: { time: value, comment: prev[index]?.comment ?? '' },
        }));
    });
    const skipSave = useRef(false);
    const skipLogged = useRef<number | null>(null);
    const saving = useRef(false);
    const canWriteSummary = isWorkspaceReady && !!workspaceOwnerId && session.user_id === workspaceOwnerId;
    const showSummary = stored.trim() !== '' || logged.length === 0;
    const writeLine = record.canWrite
        ? 'underline decoration-border decoration-1 underline-offset-4'
        : 'read-only:cursor-default';

    useEffect(() => {
        setNotes(stored);
        setError(null);
    }, [stored]);

    useEffect(() => {
        setDrafts(Object.fromEntries(logged.map((note) => [note.index, { time: note.time, comment: note.comment }])));
    }, [logged]);

    const saveSummary = async () => {
        if (skipSave.current) {
            skipSave.current = false;
            return;
        }
        if (!canWriteSummary || summaryPending || saving.current) return;
        const next = notes.trim() || null;
        if (next === (stored.trim() || null)) {
            setNotes(stored);
            setError(null);
            return;
        }
        setError(null);
        saving.current = true;
        try {
            await mutateAsync({ id: session.id, notes: next });
            setNotes(next ?? '');
        } catch (err) {
            setError(record.errorText(err));
        } finally {
            saving.current = false;
        }
    };

    const saveLogged = async (index: number) => {
        if (skipLogged.current === index) {
            skipLogged.current = null;
            return;
        }
        const note = logged.find((item) => item.index === index);
        const draft = drafts[index];
        if (!note || !draft || !record.canWrite || record.isPending || saving.current) return;
        const committed = commitEditTime(draft.time);
        const timeSec = parseEditTime(committed);
        if (timeSec == null) {
            setTimeError(index);
            return;
        }
        const comment = draft.comment.trim();
        if (timeSec === note.timeSec && comment === note.comment) {
            setTimeError((current) => (current === index ? null : current));
            return;
        }
        const events = updateRecordedNote(session.events, index, timeSec, comment);
        if (!events) return;
        setError(null);
        setTimeError(null);
        saving.current = true;
        try {
            await record.saveEvents(events);
        } catch (err) {
            setError(record.errorText(err));
        } finally {
            saving.current = false;
        }
    };

    const removeLogged = async (index: number) => {
        if (!record.canWrite || record.isPending || saving.current) return;
        const events = removeRecordedNote(session.events, index);
        if (!events) return;
        setError(null);
        saving.current = true;
        try {
            await record.saveEvents(events);
        } catch (err) {
            setError(record.errorText(err));
        } finally {
            saving.current = false;
        }
    };

    const addLogged = async () => {
        if (!record.canWrite || record.isPending || saving.current) return;
        const comment = addComment.trim();
        const timeSec = parseEditTime(commitEditTime(addTime));
        if (!comment) return;
        if (timeSec == null) {
            setTimeError('new');
            return;
        }
        setError(null);
        setTimeError(null);
        saving.current = true;
        try {
            await record.saveEvents(insertRecordedNote(session.events, timeSec, comment));
            setAddTime('');
            setAddComment('');
        } catch (err) {
            setError(record.errorText(err));
        } finally {
            saving.current = false;
        }
    };

    return (
        <div className="space-y-3">
            {(logged.length > 0 || record.canWrite) && (
                <ul ref={setTimeRoot} className="m-0 list-none space-y-2 p-0">
                    {logged.map((note) => {
                        const draft = drafts[note.index] ?? { time: note.time, comment: note.comment };
                        const controls = formatRoastNote({ gas: note.gas, airflow: note.airflow, drum: note.drum });
                        return (
                            <li key={note.index} className="flex items-start gap-2">
                                <input
                                    data-testid="history-recorded-note-time"
                                    data-time-key={note.index}
                                    aria-label={`${note.time} ${t('history.edit.time')}`}
                                    value={draft.time}
                                    inputMode="numeric"
                                    autoComplete="off"
                                    spellCheck={false}
                                    readOnly={!record.canWrite}
                                    disabled={record.isPending}
                                    onChange={(event) => {
                                        if (!isPartialTime(event.target.value)) {
                                            event.target.value = draft.time;
                                            return;
                                        }
                                        setDrafts((prev) => ({
                                            ...prev,
                                            [note.index]: { ...draft, time: event.target.value },
                                        }));
                                        setTimeError((current) => (current === note.index ? null : current));
                                    }}
                                    onBlur={() => void saveLogged(note.index)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') event.currentTarget.blur();
                                    }}
                                    className={`w-16 shrink-0 border-0 bg-transparent p-0 font-mono text-[13px] leading-6 text-muted outline-none ${writeLine}`}
                                />
                                <span className="min-w-0 flex-1">
                                    <input
                                        data-testid="history-recorded-note"
                                        aria-label={note.time}
                                        value={draft.comment}
                                        readOnly={!record.canWrite}
                                        disabled={record.isPending}
                                        onChange={(event) => {
                                            setDrafts((prev) => ({
                                                ...prev,
                                                [note.index]: { ...draft, comment: event.target.value },
                                            }));
                                            setError(null);
                                        }}
                                        onBlur={() => void saveLogged(note.index)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                event.currentTarget.blur();
                                            }
                                            if (event.key !== 'Escape') return;
                                            event.preventDefault();
                                            skipLogged.current = note.index;
                                            setDrafts((prev) => ({
                                                ...prev,
                                                [note.index]: { time: note.time, comment: note.comment },
                                            }));
                                            setTimeError((current) => (current === note.index ? null : current));
                                            event.currentTarget.blur();
                                        }}
                                        className={`w-full border-0 bg-transparent p-0 text-[13px] leading-6 text-secondary outline-none ${writeLine}`}
                                    />
                                    {controls && <span className="block text-[12px] text-muted">{controls}</span>}
                                    {timeError === note.index && (
                                        <span role="alert" className="block text-xs text-error">
                                            {t('history.edit.invalidTime')}
                                        </span>
                                    )}
                                </span>
                                {record.canWrite && (
                                    <button
                                        type="button"
                                        data-testid="history-note-delete"
                                        aria-label={t('common.delete')}
                                        disabled={record.isPending}
                                        onClick={() => void removeLogged(note.index)}
                                        className="shrink-0 cursor-pointer rounded-md border border-border-subtle bg-transparent px-2 py-0.5 text-[11px] text-muted hover:text-red-600 disabled:opacity-40"
                                    >
                                        {t('common.delete')}
                                    </button>
                                )}
                            </li>
                        );
                    })}
                    {record.canWrite && (
                        <li className="flex items-start gap-2">
                            <input
                                data-testid="history-note-add-time"
                                data-time-key="new"
                                aria-label={t('history.edit.time')}
                                value={addTime}
                                placeholder="00:00"
                                inputMode="numeric"
                                autoComplete="off"
                                spellCheck={false}
                                disabled={record.isPending}
                                onChange={(event) => {
                                    if (!isPartialTime(event.target.value)) {
                                        event.target.value = addTime;
                                        return;
                                    }
                                    setAddTime(event.target.value);
                                    setTimeError((current) => (current === 'new' ? null : current));
                                }}
                                className={`w-16 shrink-0 border-0 bg-transparent p-0 font-mono text-[13px] leading-6 text-muted outline-none placeholder:text-muted ${writeLine}`}
                            />
                            <input
                                data-testid="history-note-add"
                                aria-label={t('history.recordText.add')}
                                value={addComment}
                                placeholder={t('history.recordText.add')}
                                disabled={record.isPending}
                                onChange={(event) => setAddComment(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key !== 'Enter') return;
                                    event.preventDefault();
                                    void addLogged();
                                }}
                                className={`min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] leading-6 text-secondary outline-none placeholder:text-muted ${writeLine}`}
                            />
                            <button
                                type="button"
                                aria-label={t('history.recordText.add')}
                                disabled={record.isPending || !addComment.trim()}
                                onClick={() => void addLogged()}
                                className="shrink-0 cursor-pointer rounded-md border border-border-subtle bg-transparent px-2 py-0.5 text-[11px] text-muted hover:text-primary disabled:opacity-40"
                            >
                                {t('history.recordText.add')}
                            </button>
                        </li>
                    )}
                </ul>
            )}
            {timeError === 'new' && (
                <p role="alert" className="text-xs text-error">
                    {t('history.edit.invalidTime')}
                </p>
            )}
            {showSummary && (
                <textarea
                    data-testid="history-record-notes"
                    aria-label={t('history.expanded.notes')}
                    value={notes}
                    placeholder={logged.length > 0 ? '' : t('history.noNotes')}
                    readOnly={!canWriteSummary}
                    disabled={summaryPending}
                    rows={logged.length > 0 ? 3 : 4}
                    onChange={(event) => {
                        setNotes(event.target.value);
                        setError(null);
                    }}
                    onBlur={() => void saveSummary()}
                    onKeyDown={(event) => {
                        if (event.key !== 'Escape') return;
                        event.preventDefault();
                        setNotes(stored);
                        setError(null);
                        if (document.activeElement === event.currentTarget) {
                            skipSave.current = true;
                            event.currentTarget.blur();
                        }
                    }}
                    className="w-full resize-y rounded-md border border-border-subtle bg-main-bg px-3 py-2 text-[13px] leading-6 text-secondary outline-none placeholder:text-muted focus:border-border read-only:cursor-default read-only:border-transparent read-only:bg-transparent read-only:px-0"
                />
            )}
            {error && (
                <p role="alert" className="text-xs text-error">
                    {error}
                </p>
            )}
        </div>
    );
};
