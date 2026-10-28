import { getResolvedEventColor, isChartEventMarker } from '@features/active-roast/lib/chart-config';
import { fanDrumMarkersFromStored } from '@features/active-roast/lib/fan-drum-markers';
import { omitRepeatHeaterMarks } from '@features/active-roast/lib/repeat-heater';
import { tempUnitLabel, toDisplayTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { formatSignedElapsed } from '@shared/lib/format';
import { parseEditTime } from '@shared/lib/time-edit';
import type { Json } from '@shared/types/database.types';
import type { AppliedRoastControl, LogEntry, RoastNoteControls, StoredRoastEvent } from '@shared/types/roast';

const formatStoredEventTemp = (tempC: number | null | undefined, unit: TemperatureUnit): string =>
    tempC != null && Number.isFinite(tempC) ? `${Math.round(toDisplayTemp(tempC, unit))}${tempUnitLabel(unit)}` : '—';

/** Prefer stored timeSec; fall back to display "m:ss". null = neither yields a valid time. */
export const logEntryTimeSec = (entry: Pick<LogEntry, 'time' | 'timeSec'>): number | null =>
    entry.timeSec ?? parseEditTime(entry.time);

/** LogEntry[] → DB jsonb payload (skips ephemeral "Now" rows). */
export const serializeRoastEvents = (logEntries: LogEntry[]): StoredRoastEvent[] =>
    logEntries
        .filter((e) => !e.current && e.event !== 'Now')
        .flatMap((e): StoredRoastEvent[] => {
            const timeSec = logEntryTimeSec(e);
            if (timeSec == null) return [];
            return [
                {
                    id: e.id ?? crypto.randomUUID(),
                    type: e.event,
                    time_sec: timeSec,
                    temp_c: e.tempC ?? null,
                    note: e.note || null,
                    ...(e.appliedControl ? { applied_control: e.appliedControl } : {}),
                    ...(e.gas ? { gas: e.gas } : {}),
                    ...(e.airflow ? { airflow: e.airflow } : {}),
                    ...(e.drum ? { drum: e.drum } : {}),
                },
            ];
        })
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
        const applied = o.applied_control;
        const appliedControl: AppliedRoastControl = {};
        if (applied && typeof applied === 'object') {
            for (const role of ['heater', 'fan', 'drum'] as const) {
                const value = (applied as Record<string, unknown>)[role];
                if (typeof value === 'number' && Number.isFinite(value)) appliedControl[role] = value;
            }
        }
        out.push({
            id: typeof o.id === 'string' ? o.id : crypto.randomUUID(),
            type,
            time_sec: timeSec,
            temp_c: optionalJsonNumber(o.temp_c),
            note: optionalJsonString(o.note),
            ...(Object.keys(appliedControl).length ? { applied_control: appliedControl } : {}),
            ...(typeof o.gas === 'string' && o.gas ? { gas: o.gas } : {}),
            ...(typeof o.airflow === 'string' && o.airflow ? { airflow: o.airflow } : {}),
            ...(typeof o.drum === 'string' && o.drum ? { drum: o.drum } : {}),
        });
    }
    return out;
};

export type HistoryEventMarker = RoastNoteControls & {
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
export const storedEventsToLogEntries = (
    events: StoredRoastEvent[],
    unit: TemperatureUnit,
    includeControls = false,
): LogEntry[] =>
    [...events]
        .filter((e) => includeControls || e.type !== 'Control')
        .sort((a, b) => a.time_sec - b.time_sec)
        .map((e) => ({
            id: e.id,
            time: formatSignedElapsed(e.time_sec),
            timeSec: e.time_sec,
            event: e.type,
            temp: formatStoredEventTemp(e.temp_c, unit),
            tempC: e.temp_c ?? null,
            note: e.note ?? '',
            ...(includeControls && e.applied_control ? { appliedControl: e.applied_control } : {}),
            ...(e.gas ? { gas: e.gas } : {}),
            ...(e.airflow ? { airflow: e.airflow } : {}),
            ...(e.drum ? { drum: e.drum } : {}),
        }));

/** Only explicit acknowledged app writes supply control-chart change labels. */
export const storedEventsToControlChanges = (events: StoredRoastEvent[]) =>
    events.flatMap((event) =>
        event.type === 'Control' && event.applied_control
            ? [{ timeSec: event.time_sec, values: event.applied_control }]
            : [],
    );

/** Stored events → chart markers. Live TP is a `turningPoints` overlay, not an eventMarker — include it here so history can draw it. */
export const storedEventsToMarkers = (
    events: StoredRoastEvent[],
    unit: TemperatureUnit = 'C',
): HistoryEventMarker[] => [
    ...omitRepeatHeaterMarks(
        events
            .filter((e) => isChartEventMarker(e.type) || e.type === 'TP')
            .map((e) => ({
                logId: e.id,
                timeSec: e.time_sec,
                event: e.type,
                color: getResolvedEventColor(e.type),
                timeStr: formatSignedElapsed(e.time_sec),
                temp: e.temp_c != null ? `${Math.round(toDisplayTemp(e.temp_c, unit))}` : '',
                tempC: e.temp_c ?? null,
                note: e.note ?? '',
                ...(e.gas ? { gas: e.gas } : {}),
                ...(e.airflow ? { airflow: e.airflow } : {}),
                ...(e.drum ? { drum: e.drum } : {}),
            })),
    ),
    ...fanDrumMarkersFromStored(events),
];

const NOTE_CONTROL_KEYS = ['gas', 'airflow', 'drum'] as const;

/** Saved note row behind a chart label. Time, comment, and the manual values can change. */
export const patchStoredNoteEvent = (
    raw: unknown,
    logId: string,
    patch: { timeSec?: number; note?: string; gas?: string; airflow?: string; drum?: string },
): Json | null => {
    if (!Array.isArray(raw)) return null;
    let found = false;
    const next = raw.map((item) => {
        if (item == null || typeof item !== 'object' || Array.isArray(item)) return item;
        if ((item as { id?: unknown; type?: unknown }).id !== logId) return item;
        if ((item as { type?: unknown }).type !== 'Note') return item;
        found = true;
        const row = { ...(item as Record<string, unknown>) };
        if (patch.timeSec != null && Number.isFinite(patch.timeSec)) row.time_sec = Math.round(patch.timeSec);
        if (patch.note != null) {
            const note = patch.note.trim();
            if (note) row.note = note;
            else delete row.note;
        }
        for (const key of NOTE_CONTROL_KEYS) {
            const value = patch[key];
            if (value === undefined) continue;
            const trimmed = value.trim();
            if (trimmed) row[key] = trimmed;
            else delete row[key];
        }
        return row;
    });
    return found ? (next as Json) : null;
};
