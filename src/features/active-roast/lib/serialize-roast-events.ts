import { getResolvedEventColor, isChartEventMarker } from '@features/active-roast/lib/chart-config';
import { tempUnitLabel, toDisplayTemp } from '@features/active-roast/lib/temperature';
import { parseTimeSec } from '@features/active-roast/lib/time';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { formatElapsed } from '@shared/lib/format';
import type { LogEntry, StoredRoastEvent } from '@shared/types/roast';

const formatStoredEventTemp = (tempC: number | null | undefined, unit: TemperatureUnit): string =>
    tempC != null && Number.isFinite(tempC) ? `${Math.round(toDisplayTemp(tempC, unit))}${tempUnitLabel(unit)}` : '—';

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
    logId?: string;
    timeSec: number;
    event: string;
    color: string;
    timeStr: string;
    temp: string;
    tempC?: number | null;
    note?: string;
};

/** Stored events → read-only log rows for profile/history UI. */
export const storedEventsToLogEntries = (events: StoredRoastEvent[], unit: TemperatureUnit): LogEntry[] =>
    [...events]
        .sort((a, b) => a.time_sec - b.time_sec)
        .map((e) => ({
            id: e.id,
            time: formatElapsed(e.time_sec),
            timeSec: e.time_sec,
            event: e.type,
            temp: formatStoredEventTemp(e.temp_c, unit),
            tempC: e.temp_c ?? null,
            note: e.note ?? '',
        }));

/** Stored events → chart markers. Live TP is a `turningPoints` overlay, not an eventMarker — include it here so history can draw it. */
export const storedEventsToMarkers = (events: StoredRoastEvent[], unit: TemperatureUnit = 'C'): HistoryEventMarker[] =>
    events
        .filter((e) => isChartEventMarker(e.type) || e.type === 'TP')
        .map((e) => ({
            logId: e.id,
            timeSec: Math.max(0, e.time_sec),
            event: e.type,
            color: getResolvedEventColor(e.type),
            timeStr: formatElapsed(e.time_sec),
            temp: e.temp_c != null ? `${Math.round(toDisplayTemp(e.temp_c, unit))}` : '',
            tempC: e.temp_c ?? null,
            note: e.note ?? '',
        }));
