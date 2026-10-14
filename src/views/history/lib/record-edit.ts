import { fromDisplayTemp, type TemperatureUnit, toDisplayTemp } from '@features/active-roast';
import { isCustomRoastEvent } from '@features/active-roast/lib/event-buttons';
import { formatElapsed } from '@shared/lib/format';
import type { Json } from '@shared/types/database.types';

/** Editable key marks in Charge-relative order. Equal times are allowed (FC Start = FC Rolling). */
export const KEY_EVENT_ORDER = ['Charge', 'TP', 'Yellow', 'FC Start', 'FC Rolling', 'FC End', 'Drop', 'End'];

/** Missing marks the History editor may insert. Charge/Drop/End stay the roast boundaries. */
export const ADDABLE_KEY_EVENTS = ['TP', 'Yellow', 'FC Start', 'FC Rolling', 'FC End'] as const;

/** Recorded boundaries. Time, temperature, and the row itself stay as saved. */
const FIXED_MARKS = new Set(['Charge', 'Drop']);
const isFixedMark = (type: string) => FIXED_MARKS.has(type);

/** FC Start first — that is the mark a saved roast is most often missing. */
const ADD_PREFERENCE = ['FC Start', 'Yellow', 'FC Rolling', 'FC End', 'TP'] as const;

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

/** Key marks keep their phase order. A custom name has no phase, so it sorts after a mark at the same second. */
const orderRank = (type: string) => {
    const placed = rank(type);
    return placed >= 0 ? placed : KEY_EVENT_ORDER.length;
};

const isListed = (type: string) => rank(type) >= 0 || isCustomRoastEvent(type);

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

/** Key marks and custom names. Note/Heater rows stay out of the list and are preserved. */
export const toEventDrafts = (raw: unknown, unit: TemperatureUnit): EventDraft[] =>
    asRawEvents(raw)
        .map((e, index) => ({ e, index }))
        .filter(({ e }) => typeof e.type === 'string' && isListed(e.type) && typeof e.time_sec === 'number')
        .sort(
            (a, b) =>
                (a.e.time_sec as number) - (b.e.time_sec as number) ||
                orderRank(a.e.type as string) - orderRank(b.e.type as string) ||
                a.index - b.index,
        )
        .map(({ e, index }) => ({
            index,
            type: e.type as string,
            time: formatElapsed(e.time_sec as number),
            temp: displayTemp(e.temp_c, unit),
        }));

const parseTime = (value: string): number | null => {
    const m = TIME_RE.exec(value.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Time order, then phase order. Empty times stay put relative to each other. */
export const compareEventDrafts = (a: EventDraft, b: EventDraft): number => {
    const left = parseTime(a.time);
    const right = parseTime(b.time);
    if (left != null && right != null && left !== right) return left - right;
    return orderRank(a.type) - orderRank(b.type) || a.index - b.index;
};

const parseTempC = (value: string, unit: TemperatureUnit): number | null => {
    const trimmed = value.trim();
    if (!NUMBER_RE.test(trimmed)) return null;
    const c = fromDisplayTemp(Number(trimmed), unit);
    if (!Number.isFinite(c) || c < TEMP_MIN_C || c > TEMP_MAX_C) return null;
    return Math.round(c * 10) / 10;
};

/**
 * Apply form rows onto the stored events array. Existing listed marks only change time_sec/temp_c
 * and keep their id and unknown fields. A listed mark missing from the drafts is deleted,
 * except Charge and Drop. Negative-index rows are new TP/Yellow/FC marks, or custom names.
 * The same custom name may be added more than once. Charge and Drop stay as saved.
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
            if (!isFixedMark(init.type) && d.time.trim() !== init.time) {
                const parsed = parseTime(d.time);
                if (parsed == null) {
                    errors[d.index] = 'time';
                    continue;
                }
                time = parsed;
                rowChanged = true;
            }
            if (!isFixedMark(init.type) && d.temp.trim() !== init.temp) {
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

        // Positive indexes that are not a listed mark are junk, not new rows.
        if (d.index >= 0) continue;
        const custom = isCustomRoastEvent(d.type);
        // Charge/Drop/End and a second copy of a singleton share one error: the editor never offers them.
        // A custom name may repeat.
        if (!custom && (!isAddable(d.type) || originalTypes.has(d.type) || typeCount(d.type) > 1)) {
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
    const removed = new Set<number>();
    for (let index = 0; index < src.length; index += 1) {
        const e = src[index];
        if (seen.has(index)) continue;
        if (typeof e.type !== 'string' || !isListed(e.type) || typeof e.time_sec !== 'number') continue;
        if (isFixedMark(e.type)) {
            times.push({ index, type: e.type, t: e.time_sec });
            continue;
        }
        removed.add(index);
        changed = true;
    }

    for (const a of times) {
        for (const b of times) {
            if (rank(a.type) < 0 || rank(b.type) < 0) continue;
            if (rank(a.type) < rank(b.type) && a.t > b.t) errors[b.index] ??= 'order';
        }
    }
    if (Object.keys(errors).length > 0) return { ok: false, errors };

    const kept = next.filter((_, index) => !removed.has(index));
    for (const event of [...additions].sort((a, b) => (a.time_sec as number) - (b.time_sec as number))) {
        insertByTime(kept, event);
        changed = true;
    }
    return { ok: true, events: kept as Json, changed };
};
