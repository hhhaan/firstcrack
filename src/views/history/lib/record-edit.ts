import { type SessionSummary, summarizeSessionEvents } from '@entities/roast-profile';
import { fromDisplayTemp, type TemperatureUnit, toDisplayTemp } from '@features/active-roast';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { formatElapsed } from '@shared/lib/format';
import { ADDABLE_ROAST_EVENTS, ROAST_KEY_EVENT_ORDER } from '@shared/lib/roast-events';
import type { Json } from '@shared/types/database.types';

/** Editable key marks in Charge-relative order. Equal times are allowed (FC Start = FC Rolling). */
export const KEY_EVENT_ORDER: string[] = [...ROAST_KEY_EVENT_ORDER];

/** Missing marks the History editor may insert. Charge/Drop/End stay the roast boundaries. */
export const ADDABLE_KEY_EVENTS = ADDABLE_ROAST_EVENTS;

/** FC Start first — that is the mark a saved roast is most often missing. */
const ADD_PREFERENCE = ['FC Start', 'Yellow', 'FC Rolling', 'FC End', 'TP', 'Color Change', 'SC Start'] as const;

export const nextAddableEvent = (present: Iterable<string>): (typeof ADDABLE_KEY_EVENTS)[number] | null => {
    const have = new Set(present);
    return ADD_PREFERENCE.find((type) => !have.has(type)) ?? null;
};

// ponytail: fixed BT sanity band; switch to roaster probe limits if a real reading ever falls outside it
const TEMP_MIN_C = 0;
const TEMP_MAX_C = 400;
const TIME_RE = /^(\d{1,2}):([0-5]\d)$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

export type EventDraft = {
    /** Stored-array index. Negative = a row the editor added, not yet in the array. */
    index: number;
    type: string;
    time: string;
    temp: string;
};

export type EventDraftError = 'time' | 'temp' | 'order' | 'duplicate';

export type EventEditResult =
    | { ok: true; events: Json; changed: boolean }
    | { ok: false; errors: Partial<Record<number, EventDraftError>> };

type RawEvent = Record<string, unknown>;

const asRawEvents = (raw: unknown): RawEvent[] =>
    Array.isArray(raw) ? raw.map((e) => (e != null && typeof e === 'object' ? (e as RawEvent) : {})) : [];

const rank = (type: string) => KEY_EVENT_ORDER.indexOf(type);

const isAddable = (type: string): type is (typeof ADDABLE_KEY_EVENTS)[number] =>
    (ADDABLE_KEY_EVENTS as readonly string[]).includes(type);

/** Insert without moving events that share this time — equal marks stay in their previous order. */
const insertByTime = (arr: unknown[], event: RawEvent) => {
    const t = event.time_sec as number;
    const at = arr.findIndex((item) => {
        if (item == null || typeof item !== 'object') return false;
        const time = (item as RawEvent).time_sec;
        return typeof time === 'number' && time > t;
    });
    if (at === -1) arr.push(event);
    else arr.splice(at, 0, event);
};

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
 * Apply form rows onto the stored events array. Existing key marks only change time_sec/temp_c
 * and keep their id and unknown fields. Negative-index rows are inserted as new TP/Yellow/FC
 * marks. Charge time stays the 0:00 axis origin.
 */
export const applyEventDrafts = (raw: unknown, drafts: EventDraft[], unit: TemperatureUnit): EventEditResult => {
    const src = asRawEvents(raw);
    const initial = new Map(toEventDrafts(raw, unit).map((d) => [d.index, d]));
    const next: unknown[] = Array.isArray(raw) ? [...raw] : [];
    const errors: Partial<Record<number, EventDraftError>> = {};
    const times: { index: number; type: string; t: number }[] = [];
    const additions: RawEvent[] = [];
    let changed = false;
    const originalTypes = new Set(
        src.flatMap((e) => (typeof e.type === 'string' && rank(e.type) >= 0 ? [e.type] : [])),
    );
    const typeCount = (type: string) => drafts.filter((d) => (initial.get(d.index)?.type ?? d.type) === type).length;

    for (const d of drafts) {
        const init = initial.get(d.index);
        if (init) {
            const orig = src[d.index];
            if (!orig) continue;
            let time = orig.time_sec as number;
            let temp = orig.temp_c;
            let rowChanged = false;
            // Draft type is ignored — an existing mark cannot be renamed.
            if (init.type !== 'Charge' && d.time.trim() !== init.time) {
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
            times.push({ index: d.index, type: init.type, t: time });
            if (rowChanged) {
                next[d.index] = { ...orig, time_sec: time, temp_c: temp };
                changed = true;
            }
            continue;
        }

        // Positive indexes that are not a stored key mark are junk, not new rows.
        if (d.index >= 0) continue;
        // Charge/Drop/End and a second copy of a singleton share one error: the editor never offers them.
        if (!isAddable(d.type) || originalTypes.has(d.type) || typeCount(d.type) > 1) {
            errors[d.index] = 'duplicate';
            continue;
        }
        const parsedTime = parseTime(d.time);
        if (parsedTime == null) {
            errors[d.index] = 'time';
            continue;
        }
        let temp: number | null = null;
        if (d.temp.trim() !== '') {
            const parsedTemp = parseTempC(d.temp, unit);
            if (parsedTemp == null) {
                errors[d.index] = 'temp';
                continue;
            }
            temp = parsedTemp;
        }
        times.push({ index: d.index, type: d.type, t: parsedTime });
        additions.push({ id: crypto.randomUUID(), type: d.type, time_sec: parsedTime, temp_c: temp });
    }

    const seen = new Set(times.map((row) => row.index));
    for (let index = 0; index < src.length; index += 1) {
        const e = src[index];
        if (seen.has(index)) continue;
        if (typeof e.type !== 'string' || rank(e.type) < 0 || typeof e.time_sec !== 'number') continue;
        times.push({ index, type: e.type, t: e.time_sec });
    }

    for (const a of times) {
        for (const b of times) {
            if (rank(a.type) < rank(b.type) && a.t > b.t) errors[b.index] ??= 'order';
        }
    }
    if (Object.keys(errors).length > 0) return { ok: false, errors };

    for (const event of [...additions].sort((a, b) => (a.time_sec as number) - (b.time_sec as number))) {
        insertByTime(next, event);
        changed = true;
    }
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
