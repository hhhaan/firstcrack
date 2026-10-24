import { useActiveWorkspace } from '@entities/organization';
import { isRoastRecordConflict, useRoastSession, useUpdateRoastRecord } from '@entities/roast';
import { recordSummary } from '@features/active-roast/lib/record-summary';
import { type ReviewEventReject, reviewEventsFromLog } from '@features/active-roast/lib/review-record-events';
import {
    logEntryTimeSec,
    parseStoredRoastEvents,
    storedEventsToLogEntries,
} from '@features/active-roast/lib/serialize-roast-events';
import { formatTemp } from '@features/active-roast/lib/temperature';
import { selectReviewSnapshot } from '@features/active-roast/model/batch';
import { useRoastingStore } from '@features/active-roast/model/status';
import { formatElapsed } from '@shared/lib/format';
import type { Json } from '@shared/types/database.types';
import type { LogEntry, RoastNoteControls } from '@shared/types/roast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reviewHeaterToSave } from './review-heater';

const READ_ONLY_CODES = ['read_only_plan', 'trial_expired', 'trial_batch_cap'];

type ExpectedRecord = { events: Json; heater: Json | null; logEntries: LogEntry[] };
type PendingEdit = { entries: LogEntry[]; previous: LogEntry[] | null };

/** Chart edits on a saved curve update the frozen log, then the saved record. */
export const useReviewCurveEdit = (sessionId: string | null) => {
    const { t } = useTranslation();
    const { workspaceOwnerId } = useActiveWorkspace();
    const session = useRoastSession(workspaceOwnerId, sessionId ?? '');
    const snapshotOwnerId = useRoastingStore((state) => selectReviewSnapshot(state)?.sessionOwnerId ?? null);
    const target = useMemo(
        () => ({ sessionId, snapshotOwnerId, workspaceOwnerId }),
        [sessionId, snapshotOwnerId, workspaceOwnerId],
    );
    const { mutateAsync } = useUpdateRoastRecord(workspaceOwnerId);
    const expected = useRef<ExpectedRecord | null>(null);
    const pending = useRef<PendingEdit | null>(null);
    const inflight = useRef(false);
    const generation = useRef<typeof target | null>(null);
    const heatTouched = useRef(false);
    const saveRef = useRef<(entries: LogEntry[], previous: LogEntry[] | null) => Promise<void>>(async () => {});
    const [error, setError] = useState<string | null>(null);
    const [reviewHeaterEvents, setReviewHeaterEvents] = useState<Json | null>(null);
    const rejectText = useCallback(
        (reason: ReviewEventReject) => {
            if (reason === 'duplicate') return t('history.edit.duplicate');
            if (reason === 'order') return t('history.edit.invalidOrder');
            if (reason === 'conflict') return t('history.edit.conflict');
            return t('history.edit.protected');
        },
        [t],
    );

    useEffect(() => {
        generation.current = target;
        expected.current = null;
        pending.current = null;
        inflight.current = false;
        heatTouched.current = false;
        setReviewHeaterEvents(null);
        setError(null);
        return () => {
            generation.current = null;
        };
    }, [target]);

    useEffect(() => {
        if (!session.data || heatTouched.current) return;
        setReviewHeaterEvents(session.data.heater_events);
    }, [session.data]);

    const save = useCallback(
        async (entries: LogEntry[], previousLog: LogEntry[] | null) => {
            const review = selectReviewSnapshot(useRoastingStore.getState());
            if (!review || review.sessionId !== sessionId || review.sessionOwnerId !== snapshotOwnerId || !previousLog)
                return;
            const epoch = target;
            if (generation.current !== epoch) return;
            // One save at a time. A newer edit replaces anything still waiting.
            if (inflight.current) {
                pending.current = { entries, previous: previousLog };
                return;
            }
            const row = session.data;
            const current =
                expected.current ??
                (row ? { events: row.events, heater: row.heater_events, logEntries: previousLog } : null);
            if (!row || !current || !sessionId) {
                pending.current = { entries, previous: previousLog };
                return;
            }
            const built = reviewEventsFromLog(current.events, entries, current.logEntries);
            if (!built.ok) {
                setError(rejectText(built.reason));
                useRoastingStore.getState().replaceReviewLog(sessionId, snapshotOwnerId, previousLog);
                setReviewHeaterEvents(current.heater);
                return;
            }
            const heater = reviewHeaterToSave(
                current.logEntries,
                entries,
                current.heater,
                storedEventsToLogEntries(parseStoredRoastEvents(built.events), 'C'),
            );
            if (!built.changed && heater === current.heater) return;
            useRoastingStore.getState().replaceReviewLog(sessionId, snapshotOwnerId, entries);
            if (heater !== current.heater) {
                heatTouched.current = true;
                setReviewHeaterEvents(heater);
            }
            const summary = recordSummary(row, built.events);
            const previous = current;
            expected.current = { events: built.events, heater, logEntries: entries };
            inflight.current = true;
            try {
                const updated = await mutateAsync({
                    sessionId: row.id,
                    expectedEvents: previous.events,
                    expectedHeaterEvents: previous.heater,
                    events: built.events,
                    heaterEvents: heater,
                    dropTempCelsius: summary.dropTempCelsius,
                    durationSeconds: summary.durationSeconds,
                    profileSummary: summary.profileSummary,
                });
                if (epoch !== generation.current) return;
                expected.current = { events: updated.events, heater: updated.heater_events, logEntries: entries };
                setReviewHeaterEvents(updated.heater_events);
                setError(null);
            } catch (cause) {
                if (epoch !== generation.current) return;
                expected.current = previous;
                if (isRoastRecordConflict(cause)) setError(t('history.edit.conflict'));
                else {
                    const text = `${(cause as { message?: unknown } | null)?.message ?? ''}`;
                    setError(
                        READ_ONLY_CODES.some((code) => text.includes(code))
                            ? t('history.edit.readOnly')
                            : t('history.edit.saveFailed'),
                    );
                }
            } finally {
                if (epoch === generation.current) {
                    inflight.current = false;
                    const next = pending.current;
                    pending.current = null;
                    if (next) await saveRef.current(next.entries, next.previous);
                }
            }
        },
        [mutateAsync, rejectText, session.data, sessionId, snapshotOwnerId, target, t],
    );

    useEffect(() => {
        saveRef.current = save;
    }, [save]);

    useEffect(() => {
        if (!session.data || !pending.current) return;
        const job = pending.current;
        pending.current = null;
        void save(job.entries, job.previous);
    }, [save, session.data]);

    const apply = useCallback(
        (entries: LogEntry[]) => {
            const review = selectReviewSnapshot(useRoastingStore.getState());
            if (!review || review.sessionId !== sessionId || review.sessionOwnerId !== snapshotOwnerId) return;
            const previous = review.logEntries;
            const loaded = expected.current != null || session.data != null;
            const stored = expected.current?.events ?? session.data?.events;
            if (!loaded) {
                pending.current = { entries, previous: pending.current?.previous ?? previous };
                useRoastingStore.getState().replaceReviewLog(sessionId, snapshotOwnerId, entries);
                return;
            }
            const built = reviewEventsFromLog(stored, entries, expected.current?.logEntries ?? previous);
            if (!built.ok) {
                setError(rejectText(built.reason));
                return;
            }
            setError(null);
            const previousHeater = expected.current?.heater ?? session.data?.heater_events ?? null;
            const heater = reviewHeaterToSave(
                expected.current?.logEntries ?? previous,
                entries,
                previousHeater,
                storedEventsToLogEntries(parseStoredRoastEvents(built.events), 'C'),
            );
            if (heater !== previousHeater) {
                heatTouched.current = true;
                setReviewHeaterEvents(heater);
            }
            useRoastingStore.getState().replaceReviewLog(sessionId, snapshotOwnerId, entries);
            void save(entries, previous);
        },
        [rejectText, save, session.data, sessionId, snapshotOwnerId],
    );

    return { applyReviewLog: apply, reviewSaveError: error, reviewHeaterEvents };
};

export const appendReviewEntry = (
    entries: LogEntry[],
    event: string,
    note: string,
    timeSec: number,
    tempC: number | null,
    unit: Parameters<typeof formatTemp>[1],
    controls?: RoastNoteControls,
): LogEntry[] => {
    const body = note.trim();
    const gas = event === 'Note' ? controls?.gas?.trim() : undefined;
    const airflow = event === 'Note' ? controls?.airflow?.trim() : undefined;
    const drum = event === 'Note' ? controls?.drum?.trim() : undefined;
    if (event === 'Note' && !body && !gas && !airflow && !drum) return entries;
    const next: LogEntry = {
        id: crypto.randomUUID(),
        time: formatElapsed(timeSec),
        timeSec,
        event,
        temp: tempC != null ? formatTemp(tempC, unit) : '',
        tempC,
        note: event === 'Note' ? body : note,
        ...(gas ? { gas } : {}),
        ...(airflow ? { airflow } : {}),
        ...(drum ? { drum } : {}),
    };
    return [...entries, next].sort((a, b) => (logEntryTimeSec(a) ?? 0) - (logEntryTimeSec(b) ?? 0));
};
