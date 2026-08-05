import type { StoredRoastEvent } from '@shared/types/roast';
import { describe, expect, it } from 'vitest';
import { deltaOrNull, deriveSessionDevMetrics } from './roast-delta';

const ev = (type: string, time_sec: number): StoredRoastEvent => ({ id: `${type}-${time_sec}`, type, time_sec });

const emptyRolling = { rollingDevTimeSec: null, rollingDevPct: null };

describe('deriveSessionDevMetrics', () => {
    it('computes dev time and pct from FC Start to Drop', () => {
        const result = deriveSessionDevMetrics([ev('FC Start', 480), ev('Drop', 600)], 600);
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
