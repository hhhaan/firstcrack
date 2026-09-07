import { formatElapsed } from '@shared/lib/format';
import type { LogEntry } from '@shared/types/roast';
import type { TemperatureUnit } from '../model/settings';
import { logEntryTimeSec } from './serialize-roast-events';
import { formatTemp } from './temperature';

export type FcDualStage = 0 | 1 | 2;

export const FC_START_EVENT = 'FC Start';
export const FC_ROLLING_EVENT = 'FC Rolling';

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
    [...entries].sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));

/** Button label: empty → Start (next action); Start/both → Rolling. */
export const fcDualButtonLabel = (stage: FcDualStage): typeof FC_START_EVENT | typeof FC_ROLLING_EVENT =>
    stage === 0 ? FC_START_EVENT : FC_ROLLING_EVENT;

/**
 * Dual-mark cycle: empty → FC Start → FC Rolling. Stage 2 is a no-op
 * (clear via roast-log delete / undo, not a 3rd click).
 * Orphan Rolling (no Start) is cleared on cycle (stage 0 repair).
 */
export const cycleFcDualEntries = (prev: LogEntry[], ctx: CycleFcDualCtx): LogEntry[] => {
    const hasStart = prev.some((e) => e.event === FC_START_EVENT);
    const hasRolling = prev.some((e) => e.event === FC_ROLLING_EVENT);

    // Orphan Rolling only → clear
    if (!hasStart && hasRolling) {
        return prev.filter((e) => e.event !== FC_ROLLING_EVENT);
    }

    const stage = getFcDualStage(prev);
    if (stage === 0) {
        return sortByTime([...prev, makeEntry(FC_START_EVENT, 'First crack started', ctx)]);
    }
    if (stage === 1) {
        return sortByTime([...prev, makeEntry(FC_ROLLING_EVENT, 'First crack rolling', ctx)]);
    }
    return prev;
};
