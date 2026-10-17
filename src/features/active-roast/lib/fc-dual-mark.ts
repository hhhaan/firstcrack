import { formatElapsed } from '@shared/lib/format';
import type { LogEntry } from '@shared/types/roast';
import type { TemperatureUnit } from '../model/settings';
import { logEntryTimeSec } from './serialize-roast-events';
import { formatTemp } from './temperature';

export type FcDualStage = 0 | 1 | 2;

export const FC_START_EVENT = 'FC Start';
export const FC_ROLLING_EVENT = 'FC Rolling';
export const FC_END_EVENT = 'FC End';

/** Stage from log: 0 empty/orphan, 1 Start only, 2 Start+Rolling. Orphan Rolling → 0. */
export const getFcDualStage = (entries: readonly Pick<LogEntry, 'event'>[]): FcDualStage => {
    const hasStart = entries.some((e) => e.event === FC_START_EVENT);
    const hasRolling = entries.some((e) => e.event === FC_ROLLING_EVENT);
    if (hasStart && hasRolling) return 2;
    if (hasStart) return 1;
    return 0;
};

export type CycleFcDualCtx = {
    elapsed: number;
    rawBT: number | null;
    unit: TemperatureUnit;
};

const makeEntry = (event: string, note: string, ctx: CycleFcDualCtx): LogEntry => ({
    id: crypto.randomUUID(),
    time: formatElapsed(ctx.elapsed),
    timeSec: ctx.elapsed,
    event,
    temp: ctx.rawBT !== null ? formatTemp(ctx.rawBT, ctx.unit) : '',
    tempC: ctx.rawBT,
    note,
});

const sortByTime = (entries: LogEntry[]): LogEntry[] =>
    [...entries].sort((a, b) => (logEntryTimeSec(a) ?? 0) - (logEntryTimeSec(b) ?? 0));

/** Button label: next action. Unwind at Start-only → unmark Start. */
export const fcDualButtonLabel = (
    stage: FcDualStage,
    unwind = false,
): typeof FC_START_EVENT | typeof FC_ROLLING_EVENT =>
    stage === 0 || (stage === 1 && unwind) ? FC_START_EVENT : FC_ROLLING_EVENT;

/** Dual-mark OFF / log toggle: drop `event`. Removing Start also drops orphan Rolling. */
export const withoutLogEvent = (prev: LogEntry[], event: string): LogEntry[] => {
    const next = prev.filter((e) => e.event !== event);
    if (event === FC_START_EVENT) {
        return next.filter((e) => e.event !== FC_ROLLING_EVENT && e.event !== FC_END_EVENT);
    }
    return next;
};

export type FcDualCycleResult = { entries: LogEntry[]; unwind: boolean };

/**
 * Dual-mark: Start → Rolling → unmark Rolling → unmark Start (#453).
 * `unwind` is the next-click mode: after dropping Rolling, the following
 * click drops Start instead of re-adding Rolling.
 * Orphan Rolling (no Start) is cleared on cycle (stage 0 repair).
 */
export const cycleFcDualEntries = (prev: LogEntry[], ctx: CycleFcDualCtx, unwind = false): FcDualCycleResult => {
    const hasStart = prev.some((e) => e.event === FC_START_EVENT);
    const hasRolling = prev.some((e) => e.event === FC_ROLLING_EVENT);

    if (!hasStart && hasRolling) {
        return { entries: prev.filter((e) => e.event !== FC_ROLLING_EVENT), unwind: false };
    }

    const stage = getFcDualStage(prev);
    if (stage === 0) {
        return {
            entries: sortByTime([...prev, makeEntry(FC_START_EVENT, 'First crack started', ctx)]),
            unwind: false,
        };
    }
    if (stage === 1) {
        if (unwind) {
            return { entries: withoutLogEvent(prev, FC_START_EVENT), unwind: false };
        }
        return {
            entries: sortByTime([...prev, makeEntry(FC_ROLLING_EVENT, 'First crack rolling', ctx)]),
            unwind: false,
        };
    }
    return { entries: prev.filter((e) => e.event !== FC_ROLLING_EVENT), unwind: true };
};
