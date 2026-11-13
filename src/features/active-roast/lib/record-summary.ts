import { type SessionSummary, summarizeSessionEvents } from '@entities/roast-profile';
import { parseStoredRoastEvents } from './serialize-roast-events';

type SessionForSummary = {
    events: unknown;
    duration_seconds: number | null;
    drop_temp_celsius: number | null;
    charge_temp_celsius: number | null;
};

export type RecordSummary = {
    dropTempCelsius: number | null;
    durationSeconds: number | null;
    /** Derived profile columns for profiles cut from this record. */
    profileSummary: Omit<SessionSummary, 'fc_time_sec'>;
};

/**
 * Session summary columns after an event edit — same precedence as the save path.
 * duration_seconds is the record end: the End mark, or Drop when the roast ended at Drop.
 * It only moves when that mark itself was moved.
 */
export const recordSummary = (session: SessionForSummary, nextEvents: unknown): RecordSummary => {
    const prev = parseStoredRoastEvents(session.events);
    const next = parseStoredRoastEvents(nextEvents);
    const endMark = next.some((e) => e.type === 'End') ? 'End' : 'Drop';
    const prevEnd = prev.find((e) => e.type === endMark)?.time_sec;
    const nextEnd = next.find((e) => e.type === endMark)?.time_sec;
    const durationSeconds = nextEnd != null && nextEnd !== prevEnd ? Math.round(nextEnd) : session.duration_seconds;
    const { fc_time_sec: _fc, ...profileSummary } = summarizeSessionEvents(next, {
        duration_seconds: durationSeconds,
        drop_temp_celsius: session.drop_temp_celsius,
        charge_temp_celsius: session.charge_temp_celsius,
    });
    void _fc;
    return { dropTempCelsius: profileSummary.drop_temp_celsius, durationSeconds, profileSummary };
};
