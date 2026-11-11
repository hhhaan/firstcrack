import { fromDisplayTemp, type TemperatureUnit, toDisplayTemp } from '@features/active-roast';
import { isCustomRoastEvent } from '@features/active-roast/lib/event-buttons';
import { linkedEventReading, type MarkerDragLivePoint } from '@features/active-roast/lib/event-marker-drag';
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
    /** Last field the user edited. The other value is derived from the measured curve. */
    edited?: 'time' | 'temp';
};

/** Charge-relative BT samples. `maxTimeSec` is the last sample, the live editor's recorded interval. */
export type MeasuredCurve = {
    points: readonly MarkerDragLivePoint[];
    maxTimeSec: number;
};

export const measuredCurve = (points: readonly MarkerDragLivePoint[]): MeasuredCurve | null => {
    let max = Number.NEGATIVE_INFINITY;
    for (const point of points) {
        if (Number.isFinite(point.time) && point.time > max) max = point.time;
    }
    if (!Number.isFinite(max) || max < 0) return null;
    return { points, maxTimeSec: max };
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

/** `8:00` and `08:00` are one instant. Incomplete text does not match. */
const sameTimeText = (left: string, right: string) => {
    const parsed = parseTime(left);
    return parsed != null && parsed === parseTime(right);
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

type ResolvedReading = { timeSec: number; tempC: number | null };

/**
 * Which field drives the live curve rule. No samples → null, and the typed pair is stored as-is.
 * ponytail: a saved record can lack a TSV; the live screen always has an elapsed bound. Upgrade: block the edit until a curve exists.
 */
const draftSource = (
    draft: EventDraft,
    previous: { time: string; temp: string } | null,
    curve: MeasuredCurve | null,
): 'time' | 'temp' | null => {
    if (!curve) return null;
    // Blur pads `8:00` to `08:00`. That is not a time edit, so it must not snap BT.
    if (draft.edited === 'time' && previous && sameTimeText(draft.time, previous.time)) return null;
    if (draft.edited) return draft.edited;
    if (!previous) return null;
    const timeChanged = draft.time.trim() !== previous.time && !sameTimeText(draft.time, previous.time);
    const tempChanged = draft.temp.trim() !== previous.temp;
    if (timeChanged && !tempChanged) return 'time';
    if (tempChanged && !timeChanged) return 'temp';
    return null;
};

const resolveDraft = (
    type: string,
    anchorTime: number,
    anchorTemp: number | null,
    draft: EventDraft,
    source: 'time' | 'temp',
    curve: MeasuredCurve,
    unit: TemperatureUnit,
): ResolvedReading | 'time' | 'temp' => {
    if (source === 'time') {
        const parsed = parseTime(draft.time);
        if (parsed == null) return 'time';
        return (
            linkedEventReading(
                { event: type, timeSec: anchorTime, tempC: anchorTemp },
                { timeSec: parsed },
                curve.points,
                unit,
                curve.maxTimeSec,
            ) ?? 'time'
        );
    }
    const parsed = parseTempC(draft.temp, unit);
    if (parsed == null) return 'temp';
    const near = parseTime(draft.time) ?? anchorTime;
    return (
        linkedEventReading(
            { event: type, timeSec: near, tempC: anchorTemp },
            { tempC: parsed },
            curve.points,
            unit,
            curve.maxTimeSec,
        ) ?? 'temp'
    );
};

/** Update the other field while typing. Incomplete input stays as typed; a rejected temperature does not move time. */
export const linkEventDraft = (
    draft: EventDraft,
    field: 'time' | 'temp',
    value: string,
    curve: MeasuredCurve | null,
    unit: TemperatureUnit,
): { draft: EventDraft; error: EventDraftError | null } => {
    if (isFixedMark(draft.type)) return { draft, error: null };
    if (field === 'time' && sameTimeText(value, draft.time)) return { draft, error: null };
    const next: EventDraft = { ...draft, [field]: value, edited: field };
    if (!curve) return { draft: next, error: null };
    if (field === 'time' && parseTime(value) == null) return { draft: next, error: null };
    if (field === 'temp' && (value.trim() === '' || !NUMBER_RE.test(value.trim()))) return { draft: next, error: null };
    if (field === 'temp' && parseTime(draft.time) == null) return { draft: next, error: null };
    const resolved = resolveDraft(
        draft.type,
        parseTime(draft.time) ?? 0,
        parseTempC(draft.temp, unit),
        next,
        field,
        curve,
        unit,
    );
    if (resolved === 'time' || resolved === 'temp') return { draft: next, error: resolved };
    const time = formatElapsed(resolved.timeSec);
    return {
        draft: {
            ...next,
            time: field === 'time' && time === value ? value : time,
            temp: field === 'temp' ? value : displayTemp(resolved.tempC, unit),
        },
        error: null,
    };
};

/**
 * Apply form rows onto the stored events array. Existing listed marks only change time_sec/temp_c
 * and keep their id and unknown fields. A listed mark missing from the drafts is deleted,
 * except Charge and Drop. Negative-index rows are new TP/Yellow/FC marks, or custom names.
 * The same custom name may be added more than once. Charge and Drop stay as saved.
 * With a measured curve, the last edited field uses the live log's time↔BT rule.
 */
export const applyEventDrafts = (
    raw: unknown,
    drafts: EventDraft[],
    unit: TemperatureUnit,
    curve: MeasuredCurve | null = null,
): EventEditResult => {
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
            const source = isFixedMark(init.type) ? null : draftSource(d, init, curve);
            if (curve && source) {
                const anchorTemp = typeof temp === 'number' && Number.isFinite(temp) ? temp : null;
                const resolved = resolveDraft(init.type, time, anchorTemp, d, source, curve, unit);
                if (resolved === 'time' || resolved === 'temp') {
                    errors[d.index] = resolved;
                    continue;
                }
                time = resolved.timeSec;
                temp = resolved.tempC;
                rowChanged = time !== orig.time_sec || temp !== orig.temp_c;
                times.push({ index: d.index, type: init.type, t: time });
                if (rowChanged) {
                    next[d.index] = { ...orig, time_sec: time, temp_c: temp };
                    changed = true;
                }
                continue;
            }
            // Draft type is ignored — an existing mark cannot be renamed.
            if (!isFixedMark(init.type) && d.time.trim() !== init.time) {
                const parsed = parseTime(d.time);
                if (parsed == null) {
                    errors[d.index] = 'time';
                    continue;
                }
                if (!sameTimeText(d.time, init.time)) {
                    time = parsed;
                    rowChanged = true;
                }
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
        const source = draftSource(d, null, curve);
        if (curve && source) {
            const resolved = resolveDraft(d.type, parsedTime, null, d, source, curve, unit);
            if (resolved === 'time' || resolved === 'temp') {
                errors[d.index] = resolved;
                continue;
            }
            times.push({ index: d.index, type: d.type, t: resolved.timeSec });
            additions.push({
                id: crypto.randomUUID(),
                type: d.type,
                time_sec: resolved.timeSec,
                temp_c: resolved.tempC,
            });
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
