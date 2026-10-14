import { useActiveWorkspace } from '@entities/organization';
import { isRoastRecordConflict, useRoastSession, useUpdateRoastRecord } from '@entities/roast';
import { recordSummary } from '@features/active-roast/lib/record-summary';
import { type ReviewEventReject, reviewEventsFromLog } from '@features/active-roast/lib/review-record-events';
import { logEntryTimeSec } from '@features/active-roast/lib/serialize-roast-events';
import { formatTemp } from '@features/active-roast/lib/temperature';
import { selectReviewSnapshot } from '@features/active-roast/model/batch';
import { useRoastingStore } from '@features/active-roast/model/status';
import { formatElapsed } from '@shared/lib/format';
import type { Json } from '@shared/types/database.types';
import type { LogEntry, RoastNoteControls } from '@shared/types/roast';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const READ_ONLY_CODES = ['read_only_plan', 'trial_expired', 'trial_batch_cap'];

type ExpectedRecord = { events: Json; heater: Json | null };
type PendingEdit = { entries: LogEntry[]; previous: LogEntry[] | null };

/** Chart edits on a saved curve update the frozen log, then the saved record. */
export const useReviewCurveEdit = (sessionId: string | null) => {
    const { t } = useTranslation();
    const { workspaceOwnerId } = useActiveWorkspace();
    const session = useRoastSession(workspaceOwnerId, sessionId ?? '');
    const { mutateAsync } = useUpdateRoastRecord(workspaceOwnerId);
    const expected = useRef<ExpectedRecord | null>(null);
    const pending = useRef<PendingEdit | null>(null);
    const inflight = useRef(false);
    const saveRef = useRef<(entries: LogEntry[], previous: LogEntry[] | null) => Promise<void>>(async () => {});
    const [error, setError] = useState<string | null>(null);
    const rejectText = useCallback(
        (reason: ReviewEventReject) => {
            if (reason === 'duplicate') return t('history.edit.duplicate');
            if (reason === 'order') return t('history.edit.invalidOrder');
            return t('history.edit.protected');
        },
        [t],
    );

    useEffect(() => {
        if (sessionId == null) return;
        expected.current = null;
        pending.current = null;
        setError(null);
    }, [sessionId]);

    const save = useCallback(
        async (entries: LogEntry[], previousLog: LogEntry[] | null) => {
            // One save at a time. A newer edit replaces anything still waiting.
            if (inflight.current) {
                pending.current = { entries, previous: previousLog };
                return;
            }
            const row = session.data;
            const current = expected.current ?? (row ? { events: row.events, heater: row.heater_events } : null);
            if (!row || !current || !sessionId) {
                pending.current = { entries, previous: previousLog };
                return;
            }
            const built = reviewEventsFromLog(current.events, entries);
            if (!built.ok) {
                setError(rejectText(built.reason));
                if (previousLog) useRoastingStore.getState().replaceReviewLog(previousLog);
                return;
            }
            if (!built.changed) return;
            useRoastingStore.getState().replaceReviewLog(entries);
            const summary = recordSummary(row, built.events);
            const previous = current;
            expected.current = { events: built.events, heater: current.heater };
            inflight.current = true;
            try {
                const updated = await mutateAsync({
                    sessionId: row.id,
                    expectedEvents: previous.events,
                    expectedHeaterEvents: previous.heater,
                    events: built.events,
                    heaterEvents: previous.heater,
                    dropTempCelsius: summary.dropTempCelsius,
                    durationSeconds: summary.durationSeconds,
                    profileSummary: summary.profileSummary,
                });
                expected.current = { events: updated.events, heater: updated.heater_events };
                setError(null);
            } catch (cause) {
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
                inflight.current = false;
                const next = pending.current;
                pending.current = null;
                if (next) void saveRef.current(next.entries, next.previous);
            }
        },
        [mutateAsync, rejectText, session.data, sessionId, t],
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
            const previous = selectReviewSnapshot(useRoastingStore.getState())?.logEntries ?? null;
            const loaded = expected.current != null || session.data != null;
            const stored = expected.current?.events ?? session.data?.events;
            if (!loaded) {
                pending.current = { entries, previous };
                return;
            }
            const built = reviewEventsFromLog(stored, entries);
            if (!built.ok) {
                setError(rejectText(built.reason));
                return;
            }
            setError(null);
            useRoastingStore.getState().replaceReviewLog(entries);
            void save(entries, previous);
        },
        [rejectText, save, session.data],
    );

    return { applyReviewLog: apply, reviewSaveError: error };
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
    return [...entries, next].sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));
};
