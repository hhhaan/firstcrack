import { useActiveWorkspace } from '@entities/organization';
import { isRoastRecordConflict, roastSessionKeys, useRoastSession, useUpdateRoastRecord } from '@entities/roast';
import { recordSummary } from '@features/active-roast/lib/record-summary';
import { type ReviewEventReject, reviewEventsFromLog } from '@features/active-roast/lib/review-record-events';
import {
    logEntryTimeSec,
    parseStoredRoastEvents,
    storedEventsToLogEntries,
} from '@features/active-roast/lib/serialize-roast-events';
import { formatTemp } from '@features/active-roast/lib/temperature';
import { selectReviewSnapshot } from '@features/active-roast/model/batch';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { useRoastingStore } from '@features/active-roast/model/status';
import { formatElapsed } from '@shared/lib/format';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import type { LogEntry, RoastNoteControls } from '@shared/types/roast';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reviewHeaterToSave } from './review-heater';

const READ_ONLY_CODES = ['read_only_plan', 'trial_expired', 'trial_batch_cap'];

type PendingEdit = { entries: LogEntry[]; previous: LogEntry[] };

const savedRecordLog = (row: RoastSessionWithRelations, unit: TemperatureUnit): LogEntry[] =>
    storedEventsToLogEntries(
        parseStoredRoastEvents(row.events).filter((event) => event.time_sec >= 0),
        unit,
        true,
    );

/** Saved events and Heat set share History's cache; only queued intent is local. */
export const useReviewCurveEdit = (sessionId: string | null, unit: TemperatureUnit = 'C') => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const snapshotOwnerId = useRoastingStore((state) => selectReviewSnapshot(state)?.sessionOwnerId ?? null);
    const target = useMemo(
        () => ({ sessionId, snapshotOwnerId, workspaceOwnerId, isWorkspaceReady }),
        [sessionId, snapshotOwnerId, workspaceOwnerId, isWorkspaceReady],
    );
    const ownerId = isWorkspaceReady && snapshotOwnerId === workspaceOwnerId ? workspaceOwnerId : '';
    const session = useRoastSession(ownerId, sessionId ?? '');
    const qc = useQueryClient();
    const { mutateAsync } = useUpdateRoastRecord(workspaceOwnerId);
    const pending = useRef<PendingEdit | null>(null);
    const inflight = useRef<PendingEdit | null>(null);
    const generation = useRef<typeof target | null>(null);
    const saveRef = useRef<(entries: LogEntry[], previous: LogEntry[]) => Promise<void>>(async () => {});
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState<{ target: typeof target; edit: PendingEdit } | null>(null);
    const readRecord = useCallback(
        () => qc.getQueryData<RoastSessionWithRelations>(roastSessionKeys.detail(ownerId, sessionId ?? '')),
        [qc, ownerId, sessionId],
    );
    const getReviewLog = useCallback(() => {
        if (generation.current !== target) return [];
        if (pending.current) return pending.current.entries;
        if (inflight.current) return inflight.current.entries;
        const row = readRecord();
        return row ? savedRecordLog(row, unit) : (selectReviewSnapshot(useRoastingStore.getState())?.logEntries ?? []);
    }, [readRecord, target, unit]);
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
        pending.current = null;
        inflight.current = null;
        setDraft(null);
        setError(null);
        return () => {
            generation.current = null;
        };
    }, [target]);

    const save = useCallback(
        async (entries: LogEntry[], previousLog: LogEntry[]) => {
            const review = selectReviewSnapshot(useRoastingStore.getState());
            if (!review || review.sessionId !== sessionId || review.sessionOwnerId !== snapshotOwnerId) return;
            const epoch = target;
            if (generation.current !== epoch || !ownerId) return;
            // One save at a time. A newer edit replaces anything still waiting.
            if (inflight.current) {
                pending.current = { entries, previous: pending.current?.previous ?? previousLog };
                setDraft({ target, edit: pending.current });
                return;
            }
            const row = readRecord();
            if (!row || !sessionId) {
                pending.current = { entries, previous: pending.current?.previous ?? previousLog };
                setDraft({ target, edit: pending.current });
                return;
            }
            const built = reviewEventsFromLog(row.events, entries, previousLog);
            if (!built.ok) {
                setError(rejectText(built.reason));
                setDraft(null);
                return;
            }
            const heater = reviewHeaterToSave(
                previousLog,
                entries,
                row.heater_events,
                storedEventsToLogEntries(parseStoredRoastEvents(built.events), unit, true),
            );
            setDraft(null);
            if (!built.changed && heater === row.heater_events) return;
            const summary = recordSummary(row, built.events);
            inflight.current = { entries, previous: previousLog };
            try {
                await mutateAsync({
                    sessionId: row.id,
                    expectedEvents: row.events,
                    expectedHeaterEvents: row.heater_events,
                    events: built.events,
                    heaterEvents: heater,
                    dropTempCelsius: summary.dropTempCelsius,
                    durationSeconds: summary.durationSeconds,
                    profileSummary: summary.profileSummary,
                });
                if (epoch !== generation.current) return;
                setError(null);
            } catch (cause) {
                if (epoch !== generation.current) return;
                // A newer queued intent includes this failed edit and can retry it.
                if (pending.current) pending.current.previous = previousLog;
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
                    inflight.current = null;
                    const next = pending.current;
                    pending.current = null;
                    setDraft(null);
                    if (next) await saveRef.current(next.entries, next.previous);
                }
            }
        },
        [mutateAsync, ownerId, readRecord, rejectText, sessionId, snapshotOwnerId, target, t, unit],
    );

    useEffect(() => {
        saveRef.current = save;
    }, [save]);

    useEffect(() => {
        if (!session.data || !pending.current || inflight.current) return;
        const job = pending.current;
        pending.current = null;
        void save(job.entries, job.previous);
    }, [save, session.data]);

    const apply = useCallback(
        (entries: LogEntry[]) => {
            const review = selectReviewSnapshot(useRoastingStore.getState());
            if (!review || review.sessionId !== sessionId || review.sessionOwnerId !== snapshotOwnerId) return;
            const previous = getReviewLog();
            setError(null);
            void save(entries, previous);
        },
        [getReviewLog, save, sessionId, snapshotOwnerId],
    );

    const queued = draft?.target === target ? draft.edit : null;
    const reviewLogEntries = useMemo(
        () => queued?.entries ?? (session.data ? savedRecordLog(session.data, unit) : null),
        [queued, session.data, unit],
    );
    const reviewHeaterEvents = useMemo(() => {
        const row = session.data;
        if (!row || !queued) return row?.heater_events ?? null;
        const built = reviewEventsFromLog(row.events, queued.entries, queued.previous);
        return built.ok
            ? reviewHeaterToSave(
                  queued.previous,
                  queued.entries,
                  row.heater_events,
                  storedEventsToLogEntries(parseStoredRoastEvents(built.events), unit, true),
              )
            : row.heater_events;
    }, [queued, session.data, unit]);
    return { applyReviewLog: apply, getReviewLog, reviewLogEntries, reviewSaveError: error, reviewHeaterEvents };
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
