import { formatElapsed } from '@shared/lib/format';
import type { AppliedRoastControl, LogEntry, RoastNoteControls, StoredRoastEvent } from '@shared/types/roast';
import type { TemperatureUnit } from '../model/settings';
import { serializeRoastEvents } from './serialize-roast-events';
import { formatTemp } from './temperature';

/** Matches `BBP_MAX_SECONDS`. Kept here so the store can import this module. */
const BBP_EVENT_WINDOW_SEC = 900;

const BBP_ALLOWED_EVENTS = new Set(['Note', 'Heater', 'Control']);

/** Crack / Drop / Charge stay roast-only. Notes, heat, and control writes can sit on BBP. */
export const isBbpAllowedEvent = (event: string): boolean => BBP_ALLOWED_EVENTS.has(event);

export const bbpWindowOrigin = (endT: number, windowSeconds = BBP_EVENT_WINDOW_SEC) =>
    Math.max(0, endT - windowSeconds);

export const bbpDisplayTime = (storedSec: number, origin: number) => storedSec - origin;

export const bbpStoredTime = (displaySec: number, origin: number) => displaySec + origin;

/** Drop events that slid out of the live 15-minute window. Times stay End-relative. */
export const clipBbpEventsToWindow = (
    events: readonly LogEntry[],
    endT: number,
    windowSeconds = BBP_EVENT_WINDOW_SEC,
): LogEntry[] => {
    const origin = bbpWindowOrigin(endT, windowSeconds);
    return events.filter((entry) => {
        const timeSec = entry.timeSec;
        return (
            timeSec != null &&
            Number.isFinite(timeSec) &&
            timeSec >= origin &&
            timeSec <= endT &&
            isBbpAllowedEvent(entry.event)
        );
    });
};

/** Same origin shift as `rebaseBbpWindow`, so event times match the kept samples. */
export const rebaseBbpEvents = (
    events: readonly LogEntry[],
    endT: number,
    windowSeconds = BBP_EVENT_WINDOW_SEC,
): LogEntry[] => {
    const origin = bbpWindowOrigin(endT, windowSeconds);
    const kept = clipBbpEventsToWindow(events, endT, windowSeconds);
    if (origin === 0) return kept;
    return kept.map((entry) => {
        const timeSec = (entry.timeSec ?? 0) - origin;
        return { ...entry, timeSec, time: formatElapsed(timeSec) };
    });
};

/** Live chart times start at the left of the kept window. */
export const bbpEventsForDisplay = (events: readonly LogEntry[], origin: number): LogEntry[] =>
    events.flatMap((entry) => {
        if (entry.timeSec == null || !Number.isFinite(entry.timeSec)) return [];
        const timeSec = bbpDisplayTime(entry.timeSec, origin);
        if (timeSec < 0) return [];
        return [{ ...entry, timeSec, time: formatElapsed(timeSec) }];
    });

export const bbpEventsFromDisplay = (events: readonly LogEntry[], origin: number): LogEntry[] =>
    events.map((entry) => {
        const timeSec = bbpStoredTime(entry.timeSec ?? 0, origin);
        return { ...entry, timeSec };
    });

/** History prefixes BBP at negative time: `t - duration`, same as `combineBbpCurve`. */
export const bbpCurveDuration = (points: readonly { t: number }[], seconds: number) =>
    Math.max(seconds, 0, ...points.map((point) => point.t));

export const toChargeRelativeBbpEvents = (
    events: readonly LogEntry[],
    points: readonly { t: number }[],
    seconds: number,
): StoredRoastEvent[] => {
    const duration = bbpCurveDuration(points, seconds);
    return serializeRoastEvents([...events]).map((event) => ({ ...event, time_sec: event.time_sec - duration }));
};

export const makeBbpLogEntry = (
    event: string,
    note: string,
    timeSec: number,
    tempC: number | null,
    unit: TemperatureUnit,
    extra?: RoastNoteControls & { appliedControl?: AppliedRoastControl },
): LogEntry | null => {
    if (!isBbpAllowedEvent(event) || !Number.isFinite(timeSec)) return null;
    const body = note.trim();
    const gas = extra?.gas?.trim();
    const airflow = extra?.airflow?.trim();
    const drum = extra?.drum?.trim();
    if (event === 'Note' && !body && !gas && !airflow && !drum) return null;
    const applied = extra?.appliedControl;
    return {
        id: crypto.randomUUID(),
        time: formatElapsed(timeSec),
        timeSec,
        event,
        temp: tempC != null && Number.isFinite(tempC) ? formatTemp(tempC, unit) : '',
        tempC: tempC != null && Number.isFinite(tempC) ? tempC : null,
        note: event === 'Note' ? body : note,
        ...(gas ? { gas } : {}),
        ...(airflow ? { airflow } : {}),
        ...(drum ? { drum } : {}),
        ...(applied && Object.keys(applied).length > 0 ? { appliedControl: applied } : {}),
    };
};
