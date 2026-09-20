import type { StoredRoastEvent } from '@shared/types/roast';
import { describe, expect, it } from 'vitest';
import { deltaOrNull, deriveRoastMetrics, deriveSessionDevMetrics, toNumericRoastEvents } from './roast-delta';

const ev = (type: string, time_sec: number): StoredRoastEvent => ({ id: `${type}-${time_sec}`, type, time_sec });

const emptyRolling = { rollingDevTimeSec: null, rollingDevPct: null };
const emptyDev = { devTimeSec: null, dtrPct: null, ...emptyRolling };

describe('deriveRoastMetrics', () => {
    it('uses Drop as roast end when End is later (FC=480/Drop=600/End=660)', () => {
        const result = deriveRoastMetrics([ev('Charge', 0), ev('FC Start', 480), ev('Drop', 600), ev('End', 660)], {
            durationFallback: 660,
        });
        expect(result.roastDurationSec).toBe(600);
        expect(result.devTimeSec).toBe(120);
        expect(result.dtrPct).toBe(20);
        expect(result.endSource).toBe('drop');
        expect(result).toMatchObject(emptyRolling);
    });

    it('keeps Drop-based metrics when End confirmation is later', () => {
        const events = [ev('FC Start', 480), ev('Drop', 600)];
        const atDrop = deriveRoastMetrics(events, { liveElapsed: 600 });
        const lateEnd = deriveRoastMetrics([...events, ev('End', 900)], { durationFallback: 900 });
        expect(lateEnd.roastDurationSec).toBe(atDrop.roastDurationSec);
        expect(lateEnd.devTimeSec).toBe(atDrop.devTimeSec);
        expect(lateEnd.dtrPct).toBe(atDrop.dtrPct);
        expect(lateEnd.endSource).toBe('drop');
    });

    it('falls back to End when Drop is missing (End=660)', () => {
        const result = deriveRoastMetrics([ev('FC Start', 480), ev('End', 660)], { durationFallback: 660 });
        expect(result.roastDurationSec).toBe(660);
        expect(result.devTimeSec).toBe(180);
        expect(result.dtrPct).toBeCloseTo(27.2727, 3);
        expect(result.endSource).toBe('end');
    });

    it('falls back to stored duration when Drop and End are missing (legacy)', () => {
        const result = deriveRoastMetrics([ev('FC Start', 450)], { durationFallback: 600 });
        expect(result.roastDurationSec).toBe(600);
        expect(result.devTimeSec).toBe(150);
        expect(result.dtrPct).toBe(25);
        expect(result.endSource).toBe('legacy');
    });

    it('uses live elapsed when in progress without Drop or End', () => {
        const result = deriveRoastMetrics([ev('FC Start', 480)], { liveElapsed: 540 });
        expect(result.roastDurationSec).toBe(540);
        expect(result.devTimeSec).toBe(60);
        expect(result.dtrPct).toBeCloseTo((60 / 540) * 100);
        expect(result.endSource).toBe('live');
    });

    it('recalculates after Drop undo to remaining End or live elapsed', () => {
        const withDrop = deriveRoastMetrics([ev('FC Start', 480), ev('Drop', 600)], { liveElapsed: 630 });
        expect(withDrop.roastDurationSec).toBe(600);
        expect(withDrop.devTimeSec).toBe(120);

        const afterUndoToLive = deriveRoastMetrics([ev('FC Start', 480)], { liveElapsed: 630 });
        expect(afterUndoToLive.roastDurationSec).toBe(630);
        expect(afterUndoToLive.devTimeSec).toBe(150);
        expect(afterUndoToLive.endSource).toBe('live');

        const afterUndoToEnd = deriveRoastMetrics([ev('FC Start', 480), ev('End', 660)], { durationFallback: 660 });
        expect(afterUndoToEnd.roastDurationSec).toBe(660);
        expect(afterUndoToEnd.devTimeSec).toBe(180);
        expect(afterUndoToEnd.endSource).toBe('end');
    });

    it('returns nulls without FC Start', () => {
        expect(deriveRoastMetrics([ev('Drop', 600)], { durationFallback: 600 })).toMatchObject({
            roastDurationSec: 600,
            ...emptyDev,
            endSource: 'drop',
        });
    });

    it('returns null development when FC Start is after the roast end', () => {
        const result = deriveRoastMetrics([ev('FC Start', 600), ev('Drop', 500)], { durationFallback: 600 });
        expect(result.roastDurationSec).toBe(500);
        expect(result).toMatchObject(emptyDev);
    });

    it('returns nulls with no events and no duration', () => {
        expect(deriveRoastMetrics([])).toEqual({
            roastDurationSec: null,
            ...emptyDev,
            endSource: null,
        });
    });

    it('returns null DTR when roast duration is 0', () => {
        const result = deriveRoastMetrics([ev('FC Start', 0), ev('Drop', 0)]);
        expect(result.roastDurationSec).toBe(0);
        expect(result.devTimeSec).toBeNull();
        expect(result.dtrPct).toBeNull();
        expect(result.endSource).toBe('drop');
    });

    it('ignores invalid event times (negative, NaN, Infinity)', () => {
        const result = deriveRoastMetrics(
            [ev('Drop', Number.NaN), ev('Drop', Number.POSITIVE_INFINITY), ev('Drop', -1), ev('End', 660)],
            { durationFallback: 700 },
        );
        expect(result.roastDurationSec).toBe(660);
        expect(result.endSource).toBe('end');
    });

    it('does not round seconds or percents during calculation', () => {
        const result = deriveRoastMetrics([ev('FC Start', 569.4), ev('Drop', 690.6)]);
        expect(result.roastDurationSec).toBe(690.6);
        expect(result.devTimeSec).toBeCloseTo(121.2);
        expect(result.dtrPct).toBeCloseTo((121.2 / 690.6) * 100);
    });

    it('computes rolling DTR from FC Rolling with the same end basis', () => {
        const result = deriveRoastMetrics(
            [ev('FC Start', 480), ev('FC Rolling', 520), ev('Drop', 600), ev('End', 660)],
            { durationFallback: 660 },
        );
        expect(result).toEqual({
            roastDurationSec: 600,
            devTimeSec: 120,
            dtrPct: 20,
            rollingDevTimeSec: 80,
            rollingDevPct: (80 / 600) * 100,
            endSource: 'drop',
        });
    });

    it('returns rolling nulls when only FC Start is present', () => {
        const result = deriveRoastMetrics([ev('FC Start', 480), ev('Drop', 600)]);
        expect(result.rollingDevTimeSec).toBeNull();
        expect(result.rollingDevPct).toBeNull();
    });

    it('returns rolling nulls for orphan FC Rolling (no FC Start)', () => {
        const result = deriveRoastMetrics([ev('FC Rolling', 520), ev('Drop', 600)]);
        expect(result).toMatchObject(emptyDev);
    });

    it('prefers duration fallback over live elapsed (completed-session contract)', () => {
        const result = deriveRoastMetrics([ev('FC Start', 480)], { durationFallback: 600, liveElapsed: 540 });
        expect(result.endSource).toBe('legacy');
        expect(result.roastDurationSec).toBe(600);
    });
});

describe('deriveSessionDevMetrics', () => {
    it('computes dev time and pct from FC Start to Drop', () => {
        const result = deriveSessionDevMetrics([ev('FC Start', 480), ev('Drop', 600)], 600);
        expect(result).toEqual({ devTimeSec: 120, devPct: 20, ...emptyRolling });
    });

    it('uses Drop for both numerator and denominator when duration_seconds is End elapsed', () => {
        const result = deriveSessionDevMetrics([ev('FC Start', 480), ev('Drop', 600), ev('End', 660)], 660);
        expect(result).toEqual({ devTimeSec: 120, devPct: 20, ...emptyRolling });
    });

    it('falls back to duration when Drop event missing', () => {
        const result = deriveSessionDevMetrics([ev('FC Start', 450)], 600);
        expect(result).toEqual({ devTimeSec: 150, devPct: 25, ...emptyRolling });
    });

    it('returns nulls without FC Start', () => {
        expect(deriveSessionDevMetrics([ev('Drop', 600)], 600)).toEqual({
            devTimeSec: null,
            devPct: null,
            ...emptyRolling,
        });
    });

    it('returns nulls when end is not after FC Start', () => {
        expect(deriveSessionDevMetrics([ev('FC Start', 600), ev('Drop', 500)], 600)).toEqual({
            devTimeSec: null,
            devPct: null,
            ...emptyRolling,
        });
    });

    it('returns nulls with no events and no duration', () => {
        expect(deriveSessionDevMetrics([], null)).toEqual({
            devTimeSec: null,
            devPct: null,
            ...emptyRolling,
        });
    });

    it('uses Drop time as total when duration is null', () => {
        const result = deriveSessionDevMetrics([ev('FC Start', 400), ev('Drop', 500)], null);
        expect(result).toEqual({ devTimeSec: 100, devPct: 20, ...emptyRolling });
    });

    it('computes rolling DTR from FC Rolling to Drop', () => {
        const result = deriveSessionDevMetrics([ev('FC Start', 480), ev('FC Rolling', 520), ev('Drop', 600)], 600);
        expect(result).toEqual({
            devTimeSec: 120,
            devPct: 20,
            rollingDevTimeSec: 80,
            rollingDevPct: (80 / 600) * 100,
        });
    });

    it('returns rolling nulls when only FC Start present', () => {
        const result = deriveSessionDevMetrics([ev('FC Start', 480), ev('Drop', 600)], 600);
        expect(result.rollingDevTimeSec).toBeNull();
        expect(result.rollingDevPct).toBeNull();
    });

    it('returns rolling nulls for orphan FC Rolling (no FC Start)', () => {
        const result = deriveSessionDevMetrics([ev('FC Rolling', 520), ev('Drop', 600)], 600);
        expect(result).toEqual({ devTimeSec: null, devPct: null, ...emptyRolling });
    });
});

describe('toNumericRoastEvents', () => {
    it('keeps finite non-negative times and skips junk', () => {
        expect(
            toNumericRoastEvents([
                { type: 'Drop', time_sec: 600 },
                { type: 'End', time_sec: Number.NaN },
                { type: 'FC Start' },
                null,
                { type: 'Charge', time_sec: 0 },
            ]),
        ).toEqual([
            { type: 'Drop', time_sec: 600 },
            { type: 'Charge', time_sec: 0 },
        ]);
    });
});

describe('deltaOrNull', () => {
    it('subtracts target from actual', () => {
        expect(deltaOrNull(205, 200)).toBe(5);
        expect(deltaOrNull(195, 200)).toBe(-5);
    });

    it('returns null when either side missing', () => {
        expect(deltaOrNull(null, 200)).toBeNull();
        expect(deltaOrNull(205, null)).toBeNull();
        expect(deltaOrNull(undefined, undefined)).toBeNull();
    });
});
