import { type SessionSummary, summarizeSessionEvents } from '@entities/roast-profile';
import { fromDisplayTemp, type TemperatureUnit, toDisplayTemp } from '@features/active-roast';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { formatElapsed } from '@shared/lib/format';
import type { Json } from '@shared/types/database.types';

/** Editable key marks in Charge-relative order. Equal times are allowed (FC Start = FC Rolling). */
export const KEY_EVENT_ORDER = ['Charge', 'TP', 'Yellow', 'FC Start', 'FC Rolling', 'FC End', 'Drop', 'End'];

// ponytail: fixed BT sanity band; switch to roaster probe limits if a real reading ever falls outside it
const TEMP_MIN_C = 0;
const TEMP_MAX_C = 400;
const TIME_RE = /^(\d{1,2}):([0-5]\d)$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

export type EventDraft = {
    /** Position in the stored events array — edits patch in place, never reorder. */
    index: number;
    type: string;
    time: string;
    temp: string;
};

export type EventDraftError = 'time' | 'temp' | 'order';

export type EventEditResult =
    | { ok: true; events: Json; changed: boolean }
    | { ok: false; errors: Partial<Record<number, EventDraftError>> };

type RawEvent = Record<string, unknown>;

const asRawEvents = (raw: unknown): RawEvent[] =>
    Array.isArray(raw) ? raw.map((e) => (e != null && typeof e === 'object' ? (e as RawEvent) : {})) : [];

const rank = (type: string) => KEY_EVENT_ORDER.indexOf(type);

const displayTemp = (tempC: unknown, unit: TemperatureUnit): string =>
    typeof tempC === 'number' && Number.isFinite(tempC) ? String(Math.round(toDisplayTemp(tempC, unit) * 10) / 10) : '';

/** Key marks of a saved record as form rows. Unknown/Note/Heater rows are left out (and preserved). */
export const toEventDrafts = (raw: unknown, unit: TemperatureUnit): EventDraft[] =>
    asRawEvents(raw)
        .map((e, index) => ({ e, index }))
        .filter(({ e }) => typeof e.type === 'string' && rank(e.type) >= 0 && typeof e.time_sec === 'number')
        .map(({ e, index }) => ({
            index,
            type: e.type as string,
            time: formatElapsed(e.time_sec as number),
            temp: displayTemp(e.temp_c, unit),
        }))
        .sort((a, b) => rank(a.type) - rank(b.type) || a.index - b.index);

const parseTime = (value: string): number | null => {
    const m = TIME_RE.exec(value.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const parseTempC = (value: string, unit: TemperatureUnit): number | null => {
    const trimmed = value.trim();
    if (!NUMBER_RE.test(trimmed)) return null;
    const c = fromDisplayTemp(Number(trimmed), unit);
    if (!Number.isFinite(c) || c < TEMP_MIN_C || c > TEMP_MAX_C) return null;
    return Math.round(c * 10) / 10;
};

/**
 * Apply form rows onto the stored events array. Only time_sec/temp_c of key marks change;
 * untouched fields keep full stored precision. Charge time stays the 0:00 axis origin.
 */
export const applyEventDrafts = (raw: unknown, drafts: EventDraft[], unit: TemperatureUnit): EventEditResult => {
    const src = asRawEvents(raw);
    const initial = new Map(toEventDrafts(raw, unit).map((d) => [d.index, d]));
    const next: unknown[] = Array.isArray(raw) ? [...raw] : [];
    const errors: Partial<Record<number, EventDraftError>> = {};
    const times: { index: number; type: string; t: number }[] = [];
    let changed = false;

    for (const d of drafts) {
        const orig = src[d.index] as RawEvent | undefined;
        const init = initial.get(d.index);
        if (!orig || !init) continue;
        let time = orig.time_sec as number;
        let temp = orig.temp_c;
        let rowChanged = false;
        if (d.type !== 'Charge' && d.time.trim() !== init.time) {
            const parsed = parseTime(d.time);
            if (parsed == null) {
                errors[d.index] = 'time';
                continue;
            }
            time = parsed;
            rowChanged = true;
        }
        if (d.temp.trim() !== init.temp) {
            const parsed = parseTempC(d.temp, unit);
            if (parsed == null) {
                errors[d.index] = 'temp';
                continue;
            }
            temp = parsed;
            rowChanged = true;
        }
        times.push({ index: d.index, type: d.type, t: time });
        if (rowChanged) {
            next[d.index] = { ...orig, time_sec: time, temp_c: temp };
            changed = true;
        }
    }

    for (const a of times) {
        for (const b of times) {
            if (rank(a.type) < rank(b.type) && a.t > b.t) errors[b.index] ??= 'order';
        }
    }
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return { ok: true, events: next as Json, changed };
};

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
