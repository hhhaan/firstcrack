import { formatElapsed } from '@shared/lib/format';
import type { LogEntry } from '@shared/types/roast';
import type { TemperatureUnit } from '../model/settings';
import { TOGGLEABLE_LOG_EVENTS } from './constants';
import { logEntryTimeSec } from './serialize-roast-events';
import { formatTemp } from './temperature';
import type { TurningPoint } from './turningPoints';

export type RoastPhaseAt = 'Drying' | 'Maillard' | 'Development';

export type RoastLogMarkCtx = {
    elapsed: number;
    rawBT: number | null;
    unit: TemperatureUnit;
    note: string;
};

export type RoastLogChargeCtx = {
    rawBT: number | null;
    unit: TemperatureUnit;
};

export type RoastLogDropCtx = {
    timeSec: number;
    bt: number | null;
    unit: TemperatureUnit;
};

const sortByTime = (entries: LogEntry[]): LogEntry[] =>
    [...entries].sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));

const makeEntry = (event: string, ctx: RoastLogMarkCtx, timeSec = ctx.elapsed): LogEntry => ({
    id: crypto.randomUUID(),
    time: formatElapsed(timeSec),
    timeSec,
    event,
    temp: ctx.rawBT !== null ? formatTemp(ctx.rawBT, ctx.unit) : '',
    tempC: ctx.rawBT,
    note: ctx.note,
});

export const findEvent = (entries: readonly LogEntry[], event: string): LogEntry | undefined =>
    entries.find((e) => e.event === event);

/** Drop mark present — auto-drop idempotency and heater auto-off (log side). */
export const hasDropped = (entries: readonly LogEntry[]): boolean => entries.some((e) => e.event === 'Drop');

export const hasEnded = (entries: readonly LogEntry[]): boolean => entries.some((e) => e.event === 'End');

/** Drop or End — alerts and auto-detection stop. */
export const isFinished = (entries: readonly LogEntry[]): boolean => hasDropped(entries) || hasEnded(entries);

/**
 * PID/Replay burner auto-off. Drop (not End-only) is the log trigger;
 * session `ended` covers confirm-end when Drop was never marked.
 */
export const heaterAutoOff = (sessionEnded: boolean, entries: readonly LogEntry[]): boolean =>
    sessionEnded || hasDropped(entries);

export const fcStart = (entries: readonly LogEntry[]): LogEntry | undefined => findEvent(entries, 'FC Start');

export const yellow = (entries: readonly LogEntry[]): LogEntry | undefined => findEvent(entries, 'Yellow');

/** Charged roast phase from log marks vs elapsed. Uncharged session names stay in the view. */
export const phaseAt = (entries: readonly LogEntry[], elapsed: number): RoastPhaseAt => {
    const fc = fcStart(entries);
    if (fc && elapsed >= logEntryTimeSec(fc)) return 'Development';
    const y = yellow(entries);
    if (y && elapsed >= logEntryTimeSec(y)) return 'Maillard';
    return 'Drying';
};

/** Prefer Drop temp, then End, then live BT (#173). */
export const dropTempC = (entries: readonly LogEntry[], fallbackBt: number | null | undefined): number | null => {
    const marked =
        entries.find((e) => e.event === 'Drop' && e.tempC != null) ??
        entries.find((e) => e.event === 'End' && e.tempC != null);
    if (marked?.tempC != null) return Math.round(marked.tempC);
    if (fallbackBt != null) return Math.round(fallbackBt);
    return null;
};

/** Add or toggle a named mark. Toggleable events unmark when already present. */
export const mark = (prev: LogEntry[], event: string, ctx: RoastLogMarkCtx): LogEntry[] => {
    if (TOGGLEABLE_LOG_EVENTS.has(event) && prev.some((e) => e.event === event)) {
        return prev.filter((e) => e.event !== event);
    }
    return sortByTime([...prev, makeEntry(event, ctx)]);
};

export const unmark = (prev: LogEntry[], id: string): LogEntry[] => prev.filter((entry) => entry.id !== id);

export const resetLog = (): LogEntry[] => [];

export const replaceWithCharge = (ctx: RoastLogChargeCtx): LogEntry[] => [
    {
        id: crypto.randomUUID(),
        time: '0:00',
        timeSec: 0,
        event: 'Charge',
        temp: formatTemp(ctx.rawBT, ctx.unit),
        tempC: ctx.rawBT,
        note: 'Bean drop detected',
    },
];

export const markDropIfAbsent = (prev: LogEntry[], ctx: RoastLogDropCtx): LogEntry[] => {
    if (hasDropped(prev)) return prev;
    const timeSec = Math.max(0, ctx.timeSec);
    return sortByTime([
        ...prev,
        {
            id: crypto.randomUUID(),
            time: formatElapsed(timeSec),
            timeSec,
            event: 'Drop',
            temp: formatTemp(ctx.bt, ctx.unit),
            tempC: ctx.bt,
            note: 'Bean drop detected',
        },
    ]);
};

export const upsertTurningPoint = (prev: LogEntry[], tp: TurningPoint, unit: TemperatureUnit): LogEntry[] => {
    const idx = prev.findIndex((e) => e.event === 'TP');
    if (idx !== -1 && tp.fallback) return prev;
    const newEntry: LogEntry = {
        id: idx === -1 ? crypto.randomUUID() : prev[idx].id,
        time: formatElapsed(tp.timeSec),
        timeSec: tp.timeSec,
        event: 'TP',
        temp: formatTemp(tp.temp, unit),
        tempC: tp.temp,
        note: tp.fallback ? 'Turning Point (fallback timeout)' : 'Turning Point detected',
    };
    const next = idx === -1 ? [...prev, newEntry] : prev.map((e, i) => (i === idx ? newEntry : e));
    return sortByTime(next);
};
