import { useActiveWorkspace } from '@entities/organization';
import { isRoastRecordConflict, useRoastSession, useUpdateRoastRecord } from '@entities/roast';
import { logEntryTimeSec, serializeRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { formatTemp } from '@features/active-roast/lib/temperature';
import { useRoastingStore } from '@features/active-roast/model/status';
import { formatElapsed } from '@shared/lib/format';
import type { Json } from '@shared/types/database.types';
import type { LogEntry, RoastNoteControls } from '@shared/types/roast';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { recordSummary } from '../../history/lib/record-edit';

const READ_ONLY_CODES = ['read_only_plan', 'trial_expired', 'trial_batch_cap'];

type ExpectedRecord = { events: Json; heater: Json | null };

/** Chart edits on a saved curve update the frozen log, then the saved record. */
export const useReviewCurveEdit = (sessionId: string | null) => {
    const { t } = useTranslation();
    const { workspaceOwnerId } = useActiveWorkspace();
    const session = useRoastSession(workspaceOwnerId, sessionId ?? '');
    const { mutateAsync } = useUpdateRoastRecord(workspaceOwnerId);
    const expected = useRef<ExpectedRecord | null>(null);
    const pending = useRef<LogEntry[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (sessionId == null) return;
        expected.current = null;
        pending.current = null;
        setError(null);
    }, [sessionId]);

    const save = useCallback(
        async (entries: LogEntry[]) => {
            const row = session.data;
            const current = expected.current ?? (row ? { events: row.events, heater: row.heater_events } : null);
            if (!row || !current || !sessionId) {
                pending.current = entries;
                return;
            }
            const events = serializeRoastEvents(entries) as Json;
            if (JSON.stringify(events) === JSON.stringify(current.events)) return;
            const summary = recordSummary(row, events);
            const previous = current;
            expected.current = { events, heater: current.heater };
            try {
                const updated = await mutateAsync({
                    sessionId: row.id,
                    expectedEvents: previous.events,
                    expectedHeaterEvents: previous.heater,
                    events,
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
            }
        },
        [mutateAsync, session.data, sessionId, t],
    );

    useEffect(() => {
        if (!session.data || !pending.current) return;
        const entries = pending.current;
        pending.current = null;
        void save(entries);
    }, [save, session.data]);

    const apply = useCallback(
        (entries: LogEntry[]) => {
            useRoastingStore.getState().replaceReviewLog(entries);
            void save(entries);
        },
        [save],
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
