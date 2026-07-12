import { getResolvedEventColor, isChartEventMarker } from '@features/active-roast/lib/chart-config';
import { parseTimeSec } from '@features/active-roast/lib/time';
import { formatElapsed } from '@shared/lib/format';
import type { LogEntry, StoredRoastEvent } from '@shared/types/roast';

/** Prefer stored timeSec; fall back to display "m:ss". */
export const logEntryTimeSec = (entry: Pick<LogEntry, 'time' | 'timeSec'>): number =>
    entry.timeSec ?? parseTimeSec(entry.time);

/** LogEntry[] → DB jsonb payload (skips ephemeral "Now" rows). */
export const serializeRoastEvents = (logEntries: LogEntry[]): StoredRoastEvent[] =>
    logEntries
        .filter((e) => !e.current && e.event !== 'Now')
        .map((e) => ({
            id: e.id ?? crypto.randomUUID(),
            type: e.event,
            time_sec: logEntryTimeSec(e),
            temp_c: e.tempC ?? null,
            note: e.note || null,
        }))
        .sort((a, b) => a.time_sec - b.time_sec);

const optionalJsonNumber = (v: unknown): number | null | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v === null) return null;
    return undefined;
};

const optionalJsonString = (v: unknown): string | null | undefined => {
    if (typeof v === 'string') return v;
    if (v === null) return null;
    return undefined;
};

/** Coerce DB/json into StoredRoastEvent[] — corrupt → []. */
export const parseStoredRoastEvents = (raw: unknown): StoredRoastEvent[] => {
    if (!Array.isArray(raw)) return [];
    const out: StoredRoastEvent[] = [];
    for (const item of raw) {
        if (item == null || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const type = typeof o.type === 'string' ? o.type : null;
        const timeSec = typeof o.time_sec === 'number' && Number.isFinite(o.time_sec) ? o.time_sec : null;
        if (!type || timeSec == null) continue;
        out.push({
            id: typeof o.id === 'string' ? o.id : crypto.randomUUID(),
            type,
            time_sec: timeSec,
            temp_c: optionalJsonNumber(o.temp_c),
            note: optionalJsonString(o.note),
        });
    }
    return out;
};

export type HistoryEventMarker = {
    timeSec: number;
    event: string;
    color: string;
    timeStr: string;
    temp: string;
};

/** Stored events → chart markers (same filter as live buildEventMarkers). */
export const storedEventsToMarkers = (events: StoredRoastEvent[]): HistoryEventMarker[] =>
    events
        .filter((e) => isChartEventMarker(e.type))
        .map((e) => ({
            timeSec: Math.max(0, e.time_sec),
            event: e.type,
            color: getResolvedEventColor(e.type),
            timeStr: formatElapsed(e.time_sec),
            temp: e.temp_c != null ? `${Math.round(e.temp_c)}` : '',
        }));
