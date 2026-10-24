import type { Json } from '@shared/types/database.types';
import type { LogEntry } from '@shared/types/roast';
import { isBbpAllowedEvent } from './bbp-events';
import { isToggleableLogEvent } from './constants';
import { isCustomRoastEvent } from './event-buttons';
import { getFcDualStage } from './fc-dual-mark';
import { logEntryTimeSec } from './serialize-roast-events';

/** Key marks the record RPC will insert once, and only when that type is absent. */
const ADDABLE_MARKS = new Set(['TP', 'Yellow', 'FC Start', 'FC Rolling', 'FC End']);

/** Rows the record RPC refuses to delete. Phase marks, End, notes, and custom names may go. */
const UNDELETABLE_MARKS = new Set(['Charge', 'Drop', 'Now', 'Control']);

const NOT_A_REVIEW_MARK = new Set(['Charge', 'Drop', 'End', 'Heater', 'Now', 'Control']);

const MARK_RANK: Record<string, number> = {
    Charge: 0,
    TP: 1,
    Yellow: 2,
    'FC Start': 3,
    'FC Rolling': 4,
    'FC End': 5,
    Drop: 6,
    End: 7,
};

const NOTE_CONTROLS = ['gas', 'airflow', 'drum'] as const;

export type ReviewEventReject = 'duplicate' | 'order' | 'protected';

export type ReviewEventsResult =
    | { ok: true; events: Json; changed: boolean }
    | { ok: false; reason: ReviewEventReject };

type RawEvent = Record<string, unknown>;

const isRawEvent = (value: unknown): value is RawEvent =>
    value != null && typeof value === 'object' && !Array.isArray(value);

const eventId = (event: RawEvent): string | null => (typeof event.id === 'string' && event.id ? event.id : null);

const eventType = (event: RawEvent): string => (typeof event.type === 'string' ? event.type : '');

const sameNumber = (stored: unknown, next: number): boolean => typeof stored === 'number' && stored === next;

const sameTemp = (stored: unknown, next: number | null): boolean =>
    next == null ? stored == null : sameNumber(stored, next);

const storedTime = (event: RawEvent): number =>
    typeof event.time_sec === 'number' && Number.isFinite(event.time_sec) ? event.time_sec : 0;

/** New and edited times must fit the record RPC. An unchanged stored time is left alone. */
const editedTime = (entry: LogEntry): number | null => {
    const time = logEntryTimeSec(entry);
    if (time == null || !Number.isFinite(time) || (time < 0 && !isBbpAllowedEvent(entry.event))) return null;
    return Math.min(time, 5999);
};

const editedTemp = (entry: LogEntry): number | null =>
    entry.tempC != null && Number.isFinite(entry.tempC) ? entry.tempC : null;

const controlValue = (entry: LogEntry, key: (typeof NOTE_CONTROLS)[number]): string | undefined => {
    const value = entry[key]?.trim();
    return value || undefined;
};

export const isReviewEditableEvent = (event: string): boolean =>
    event !== 'Charge' && event !== 'Drop' && event !== 'End';

/** Saved-curve review may remove phase marks, heater log rows, notes, and custom names. Boundary marks and the turning point stay. */
export const isReviewDeletableEvent = (event: string): boolean =>
    event !== 'TP' && (event === 'Note' || event === 'Heater' || ADDABLE_MARKS.has(event) || isCustomRoastEvent(event));

export type ReviewMarkAction = { kind: 'add'; event: string } | { kind: 'remove'; event: string };

/**
 * Side-panel press on a saved curve.
 * A second press removes a toggleable mark. Dual FC follows the live cycle, including unwind.
 * Drop and End are not buttons here.
 */
export const reviewMarkAction = (
    entries: readonly Pick<LogEntry, 'event'>[],
    event: string,
    dualFc: boolean,
    unwind: boolean,
): ReviewMarkAction | null => {
    if (NOT_A_REVIEW_MARK.has(event)) return null;
    if (event === 'FC Start' && dualFc) {
        const hasStart = entries.some((entry) => entry.event === 'FC Start');
        const hasRolling = entries.some((entry) => entry.event === 'FC Rolling');
        if (!hasStart && hasRolling) return { kind: 'remove', event: 'FC Rolling' };
        const stage = getFcDualStage(entries);
        if (stage === 2) return { kind: 'remove', event: 'FC Rolling' };
        if (stage === 1 && unwind) return { kind: 'remove', event: 'FC Start' };
        if (stage === 1) return { kind: 'add', event: 'FC Rolling' };
        return { kind: 'add', event: 'FC Start' };
    }
    if (isToggleableLogEvent(event) && entries.some((entry) => entry.event === event)) {
        return { kind: 'remove', event };
    }
    if (ADDABLE_MARKS.has(event) || isCustomRoastEvent(event)) return { kind: 'add', event };
    return null;
};

/**
 * Side-panel add while a saved curve is on screen.
 * A second singleton is ignored. Dual FC adds Rolling only after Start. Drop and End are not marks here.
 */
export const reviewMarkToAdd = (entries: readonly LogEntry[], event: string, dualFc: boolean): string | null => {
    if (
        event === 'Charge' ||
        event === 'Drop' ||
        event === 'End' ||
        event === 'Heater' ||
        event === 'Now' ||
        event === 'Control'
    )
        return null;
    if (event === 'FC Start' && dualFc) {
        if (!entries.some((entry) => entry.event === 'FC Start')) return 'FC Start';
        if (!entries.some((entry) => entry.event === 'FC Rolling')) return 'FC Rolling';
        return null;
    }
    if (ADDABLE_MARKS.has(event) && entries.some((entry) => entry.event === event)) return null;
    return event;
};

const applyNote = (raw: RawEvent, entry: LogEntry, timeSec: number, temp: number | null): RawEvent => {
    const note = entry.note.trim();
    const controls = {
        gas: controlValue(entry, 'gas'),
        airflow: controlValue(entry, 'airflow'),
        drum: controlValue(entry, 'drum'),
    };
    const storedNote = typeof raw.note === 'string' && raw.note.trim() ? raw.note : null;
    const noteSame = storedNote === (note || null);
    const controlsSame = NOTE_CONTROLS.every((key) => {
        const stored = typeof raw[key] === 'string' && raw[key] ? raw[key] : undefined;
        return stored === controls[key];
    });
    if (sameNumber(raw.time_sec, timeSec) && sameTemp(raw.temp_c, temp) && noteSame && controlsSame) return raw;
    const next: RawEvent = { ...raw, time_sec: timeSec, temp_c: temp, note: note || null };
    for (const key of NOTE_CONTROLS) {
        if (controls[key]) next[key] = controls[key];
        else delete next[key];
    }
    return next;
};

const applyExisting = (raw: RawEvent, entry: LogEntry): RawEvent => {
    const type = eventType(raw);
    const time = type === 'Charge' ? storedTime(raw) : (editedTime(entry) ?? storedTime(raw));
    const temp = editedTemp(entry);
    if (type === 'Note') return applyNote(raw, entry, time, temp);
    if (type === 'Control') {
        const applied = entry.appliedControl;
        const storedApplied = raw.applied_control;
        const appliedSame = applied == null || JSON.stringify(storedApplied ?? null) === JSON.stringify(applied);
        if (sameNumber(raw.time_sec, time) && appliedSame) return raw;
        return applied ? { ...raw, time_sec: time, applied_control: applied } : { ...raw, time_sec: time };
    }
    if (type === 'Heater') {
        const note = entry.note.trim();
        const storedNote = typeof raw.note === 'string' ? raw.note : '';
        const noteSame = !note || storedNote === note;
        if (sameNumber(raw.time_sec, time) && sameTemp(raw.temp_c, temp) && noteSame) return raw;
        return { ...raw, time_sec: time, temp_c: temp, ...(note ? { note } : {}) };
    }
    if (sameNumber(raw.time_sec, time) && sameTemp(raw.temp_c, temp)) return raw;
    return { ...raw, time_sec: time, temp_c: temp };
};

const buildNew = (entry: LogEntry): { ok: true; event: RawEvent } | { ok: false; reason: ReviewEventReject } | null => {
    const type = entry.event;
    const time = editedTime(entry);
    if (!entry.id || time == null) return { ok: false, reason: 'protected' };
    const temp = editedTemp(entry);
    if (type === 'Note') {
        const note = entry.note.trim();
        const gas = controlValue(entry, 'gas');
        const airflow = controlValue(entry, 'airflow');
        const drum = controlValue(entry, 'drum');
        if (!note && !gas && !airflow && !drum) return null;
        return {
            ok: true,
            event: {
                id: entry.id,
                type: 'Note',
                time_sec: time,
                temp_c: temp,
                note: note || null,
                ...(gas ? { gas } : {}),
                ...(airflow ? { airflow } : {}),
                ...(drum ? { drum } : {}),
            },
        };
    }
    const custom = isCustomRoastEvent(type) && type.length <= 16;
    if (!ADDABLE_MARKS.has(type) && !custom) return { ok: false, reason: 'protected' };
    return { ok: true, event: { id: entry.id, type, time_sec: time, temp_c: temp } };
};

const orderBroken = (events: RawEvent[], storedById: Map<string, RawEvent>): boolean => {
    const marks = events.flatMap((event) => {
        const rank = MARK_RANK[eventType(event)];
        if (rank == null || typeof event.time_sec !== 'number') return [];
        const id = eventId(event);
        const previous = id ? storedById.get(id) : undefined;
        const touched = !previous || !sameNumber(previous.time_sec, event.time_sec);
        return [{ rank, time: event.time_sec, touched }];
    });
    return marks.some((left) =>
        marks.some((right) => left.rank < right.rank && left.time > right.time && (left.touched || right.touched)),
    );
};

/**
 * Patch a saved `events` array from the review log.
 * New key marks and custom names carry only id, type, time, and temperature — a null note is rejected.
 * Existing rows keep every other stored key. Several legal edits go out as one array.
 */
export const reviewEventsFromLog = (storedEvents: unknown, logEntries: readonly LogEntry[]): ReviewEventsResult => {
    const stored = Array.isArray(storedEvents) ? storedEvents.filter(isRawEvent) : [];
    const storedById = new Map(
        stored.flatMap((event) => {
            const id = eventId(event);
            return id ? [[id, event] as const] : [];
        }),
    );
    const logById = new Map<string, LogEntry>();
    const added: LogEntry[] = [];
    for (const entry of logEntries) {
        if (entry.current || entry.event === 'Now') continue;
        if (entry.id && storedById.has(entry.id)) logById.set(entry.id, entry);
        else added.push(entry);
    }

    const next: RawEvent[] = [];
    for (const event of stored) {
        const id = eventId(event);
        const entry = id ? logById.get(id) : undefined;
        if (!entry) {
            if (UNDELETABLE_MARKS.has(eventType(event))) return { ok: false, reason: 'protected' };
            continue;
        }
        next.push(applyExisting(event, entry));
    }

    const present = new Set(next.map(eventType));
    for (const entry of added) {
        if (ADDABLE_MARKS.has(entry.event) && present.has(entry.event)) return { ok: false, reason: 'duplicate' };
        const built = buildNew(entry);
        if (built == null) continue;
        if (!built.ok) return built;
        if (ADDABLE_MARKS.has(eventType(built.event))) present.add(eventType(built.event));
        next.push(built.event);
    }

    if (orderBroken(next, storedById)) return { ok: false, reason: 'order' };
    return { ok: true, events: next as Json, changed: JSON.stringify(next) !== JSON.stringify(stored) };
};
