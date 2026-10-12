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
 * duration_seconds is the record End; it only moves when End itself was moved.
 */
export const recordSummary = (session: SessionForSummary, nextEvents: unknown): RecordSummary => {
    const prevEnd = parseStoredRoastEvents(session.events).find((e) => e.type === 'End')?.time_sec;
    const next = parseStoredRoastEvents(nextEvents);
    const nextEnd = next.find((e) => e.type === 'End')?.time_sec;
    const durationSeconds = nextEnd != null && nextEnd !== prevEnd ? Math.round(nextEnd) : session.duration_seconds;
    const { fc_time_sec: _fc, ...profileSummary } = summarizeSessionEvents(next, {
        duration_seconds: durationSeconds,
        drop_temp_celsius: session.drop_temp_celsius,
        charge_temp_celsius: session.charge_temp_celsius,
    });
    void _fc;
    return { dropTempCelsius: profileSummary.drop_temp_celsius, durationSeconds, profileSummary };
};
