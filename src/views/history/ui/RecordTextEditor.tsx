import { useActiveWorkspace } from '@entities/organization';
import { useUpdateRoastSession } from '@entities/roast';
import { formatRoastNote } from '@features/active-roast/lib/roast-note';
import { commitEditTime, isPartialTime, parseEditTime } from '@shared/lib/time-edit';
import { useTimeEditRoot } from '@shared/lib/useTimeEditRoot';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import {
    type CompositionEvent,
    type FocusEvent,
    type KeyboardEvent,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useRoastRecordSave } from '../hooks/useRoastRecordSave';
import { insertRecordedNote, recordedNotes, removeRecordedNote, updateRecordedNote } from '../lib/recorded-notes';

const isImeKey = (event: KeyboardEvent) =>
    event.nativeEvent.isComposing || event.key === 'Process' || event.nativeEvent.keyCode === 229;

const inputIsComposing = (event: { nativeEvent: Event }) =>
    'isComposing' in event.nativeEvent && Boolean(event.nativeEvent.isComposing);

/** Session summary note, plus the notes recorded on the roast log. */
export const RecordTextEditor = ({ session }: { session: RoastSessionWithRelations }) => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { mutateAsync, isPending: summaryPending } = useUpdateRoastSession(workspaceOwnerId);
    const record = useRoastRecordSave(session);
    const stored = session.notes ?? '';
    const logged = useMemo(() => recordedNotes(session.events), [session.events]);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [addTime, setAddTime] = useState('');
    const [addReady, setAddReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [timeError, setTimeError] = useState<string | null>(null);
    const [seenNotes, setSeenNotes] = useState(stored);
    if (seenNotes !== stored) {
        setSeenNotes(stored);
        setError(null);
    }
    const setTimeRoot = useTimeEditRoot((key, value) => {
        setTimeError((current) => (current === key ? null : current));
        if (key === 'new') {
            setAddTime(value);
            return;
        }
        setDrafts((prev) => ({ ...prev, [key]: value }));
    });
    const skipSave = useRef(false);
    const skipLogged = useRef<string | null>(null);
    const saving = useRef(false);
    const addCommentRef = useRef<HTMLInputElement>(null);
    const commentRefs = useRef(new Map<string, HTMLInputElement>());
    const composingInputs = useRef(new WeakSet<HTMLElement>());
    const blurWait = useRef(new WeakMap<HTMLElement, () => void>());
    const addAfterIme = useRef(false);
    const canWriteSummary = isWorkspaceReady && !!workspaceOwnerId && session.user_id === workspaceOwnerId;
    const showSummary = stored.trim() !== '' || logged.length === 0;
    const writeLine = record.canWrite
        ? 'underline decoration-border decoration-1 underline-offset-4'
        : 'read-only:cursor-default';

    useEffect(() => {
        setDrafts(Object.fromEntries(logged.map((note) => [note.id ?? `legacy:${note.index}`, note.time])));
    }, [logged]);

    const onCompStart = (event: CompositionEvent<HTMLElement>) => {
        composingInputs.current.add(event.currentTarget);
    };
    const finishIme = (event: CompositionEvent<HTMLElement>) => {
        composingInputs.current.delete(event.currentTarget);
        const pending = blurWait.current.get(event.currentTarget);
        if (!pending) return;
        blurWait.current.delete(event.currentTarget);
        pending();
    };
    const blurWhenImeDone = (event: FocusEvent<HTMLElement>, commit: () => void) => {
        if (composingInputs.current.has(event.currentTarget)) {
            blurWait.current.set(event.currentTarget, commit);
            return;
        }
        commit();
    };

    const saveSummary = async (el: HTMLTextAreaElement) => {
        if (skipSave.current) {
            skipSave.current = false;
            return;
        }
        if (!canWriteSummary || summaryPending || saving.current) return;
        const next = el.value.trim() || null;
        if (next === (stored.trim() || null)) {
            el.value = stored;
            setError(null);
            return;
        }
        setError(null);
        saving.current = true;
        try {
            await mutateAsync({ id: session.id, notes: next });
            if (el.isConnected) el.value = next ?? '';
        } catch (err) {
            setError(record.errorText(err));
        } finally {
            saving.current = false;
        }
    };

    const saveLogged = async (id: string, commentRaw: string) => {
        if (skipLogged.current === id) {
            skipLogged.current = null;
            return;
        }
        const note = logged.find((item) => item.id === id);
        if (!note || !record.canWrite || record.isPending || saving.current) return;
        const committed = commitEditTime(drafts[id] ?? note.time);
        const timeSec = parseEditTime(committed);
        if (timeSec == null) {
            setTimeError(id);
            return;
        }
        const comment = commentRaw.trim();
        if (timeSec === note.timeSec && comment === note.comment) {
            setTimeError((current) => (current === id ? null : current));
            return;
        }
        const events = updateRecordedNote(session.events, note.index, timeSec, comment);
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

    const removeLogged = async (id: string) => {
        if (!record.canWrite || record.isPending || saving.current) return;
        const note = logged.find((item) => item.id === id);
        if (!note) return;
        const events = removeRecordedNote(session.events, note.index);
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

    const addLogged = async (rawComment: string) => {
        if (!record.canWrite || record.isPending || saving.current) return;
        const comment = rawComment.trim();
        // The empty field shows 00:00. Treat that placeholder as the time.
        const timeSec = parseEditTime(commitEditTime(addTime.trim() === '' ? '0:00' : addTime));
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
            setAddReady(false);
            if (addCommentRef.current) addCommentRef.current.value = '';
        } catch (err) {
            setError(record.errorText(err));
        } finally {
            saving.current = false;
        }
    };

    const commitAdd = () => {
        const el = addCommentRef.current;
        if (!el) return;
        if (composingInputs.current.has(el)) {
            addAfterIme.current = true;
            el.blur();
            if (!addAfterIme.current) return;
            addAfterIme.current = false;
        }
        void addLogged(el.value);
    };

    return (
        <div className="space-y-3">
            {(logged.length > 0 || record.canWrite) && (
                <ul ref={setTimeRoot} className="m-0 list-none space-y-2 p-0">
                    {logged.map((note) => {
                        const id = note.id ?? `legacy:${note.index}`;
                        const time = drafts[id] ?? note.time;
                        const controls = formatRoastNote({ gas: note.gas, airflow: note.airflow, drum: note.drum });
                        const commentNow = () => commentRefs.current.get(id)?.value ?? note.comment;
                        return (
                            <li key={id} className="flex items-start gap-2">
                                <input
                                    data-testid="history-recorded-note-time"
                                    data-time-key={id}
                                    aria-label={`${note.time} ${t('history.edit.time')}`}
                                    value={time}
                                    inputMode="numeric"
                                    autoComplete="off"
                                    spellCheck={false}
                                    readOnly={!record.canWrite || !note.id}
                                    disabled={record.isPending}
                                    onChange={(event) => {
                                        if (inputIsComposing(event)) return;
                                        if (!isPartialTime(event.target.value)) {
                                            event.target.value = time;
                                            return;
                                        }
                                        setDrafts((prev) => ({ ...prev, [id]: event.target.value }));
                                        setTimeError((current) => (current === id ? null : current));
                                    }}
                                    onCompositionEnd={(event) => {
                                        const next = event.currentTarget.value;
                                        if (!isPartialTime(next)) {
                                            event.currentTarget.value = time;
                                            return;
                                        }
                                        setDrafts((prev) => ({ ...prev, [id]: next }));
                                    }}
                                    onBlur={() => void saveLogged(id, commentNow())}
                                    onKeyDown={(event) => {
                                        if (isImeKey(event)) return;
                                        if (event.key === 'Enter') event.currentTarget.blur();
                                    }}
                                    className={`w-16 shrink-0 border-0 bg-transparent p-0 font-mono text-[13px] leading-6 text-muted outline-none ${writeLine}`}
                                />
                                <span className="min-w-0 flex-1">
                                    <input
                                        key={`${id}:${note.comment}`}
                                        ref={(node) => {
                                            if (node) commentRefs.current.set(id, node);
                                            else commentRefs.current.delete(id);
                                        }}
                                        data-testid="history-recorded-note"
                                        aria-label={note.time}
                                        defaultValue={note.comment}
                                        readOnly={!record.canWrite || !note.id}
                                        disabled={record.isPending}
                                        autoComplete="off"
                                        spellCheck={false}
                                        onCompositionStart={onCompStart}
                                        onCompositionEnd={finishIme}
                                        onBlur={(event) => {
                                            const el = event.currentTarget;
                                            blurWhenImeDone(event, () => void saveLogged(id, el.value));
                                        }}
                                        onKeyDown={(event) => {
                                            if (isImeKey(event)) return;
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                event.currentTarget.blur();
                                            }
                                            if (event.key !== 'Escape') return;
                                            event.preventDefault();
                                            skipLogged.current = id;
                                            event.currentTarget.value = note.comment;
                                            setTimeError((current) => (current === id ? null : current));
                                            event.currentTarget.blur();
                                        }}
                                        className={`w-full border-0 bg-transparent p-0 text-[13px] leading-6 text-secondary outline-none ${writeLine}`}
                                    />
                                    {controls && <span className="block text-[12px] text-muted">{controls}</span>}
                                    {timeError === id && (
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
                                        disabled={record.isPending || !note.id}
                                        onClick={() => void removeLogged(id)}
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
                                    if (inputIsComposing(event)) return;
                                    if (!isPartialTime(event.target.value)) {
                                        event.target.value = addTime;
                                        return;
                                    }
                                    setAddTime(event.target.value);
                                    setTimeError((current) => (current === 'new' ? null : current));
                                }}
                                onCompositionEnd={(event) => {
                                    const next = event.currentTarget.value;
                                    if (!isPartialTime(next)) {
                                        event.currentTarget.value = addTime;
                                        return;
                                    }
                                    setAddTime(next);
                                }}
                                className={`w-16 shrink-0 border-0 bg-transparent p-0 font-mono text-[13px] leading-6 text-muted outline-none placeholder:text-muted ${writeLine}`}
                            />
                            <input
                                ref={addCommentRef}
                                data-testid="history-note-add"
                                aria-label={t('history.recordText.add')}
                                defaultValue=""
                                placeholder={t('history.recordText.add')}
                                disabled={record.isPending}
                                autoComplete="off"
                                spellCheck={false}
                                onInput={(event) => setAddReady(event.currentTarget.value.trim() !== '')}
                                onCompositionStart={onCompStart}
                                onCompositionEnd={(event) => {
                                    finishIme(event);
                                    setAddReady(event.currentTarget.value.trim() !== '');
                                    if (!addAfterIme.current) return;
                                    addAfterIme.current = false;
                                    void addLogged(event.currentTarget.value);
                                }}
                                onKeyDown={(event) => {
                                    if (isImeKey(event)) return;
                                    if (event.key !== 'Enter') return;
                                    event.preventDefault();
                                    void addLogged(event.currentTarget.value);
                                }}
                                className={`min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] leading-6 text-secondary outline-none placeholder:text-muted ${writeLine}`}
                            />
                            <button
                                type="button"
                                aria-label={t('history.recordText.add')}
                                disabled={record.isPending}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={commitAdd}
                                className={`shrink-0 cursor-pointer rounded-md border border-border-subtle bg-transparent px-2 py-0.5 text-[11px] text-muted hover:text-primary disabled:opacity-40 ${addReady ? '' : 'opacity-40'}`}
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
                    key={stored}
                    data-testid="history-record-notes"
                    aria-label={t('history.expanded.notes')}
                    defaultValue={stored}
                    placeholder={logged.length > 0 ? '' : t('history.noNotes')}
                    readOnly={!canWriteSummary}
                    disabled={summaryPending}
                    rows={logged.length > 0 ? 3 : 4}
                    autoComplete="off"
                    spellCheck={false}
                    onCompositionStart={onCompStart}
                    onCompositionEnd={finishIme}
                    onBlur={(event) => {
                        const el = event.currentTarget;
                        blurWhenImeDone(event, () => void saveSummary(el));
                    }}
                    onKeyDown={(event) => {
                        if (isImeKey(event)) return;
                        if (event.key !== 'Escape') return;
                        event.preventDefault();
                        event.currentTarget.value = stored;
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
