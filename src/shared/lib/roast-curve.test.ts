import { describe, expect, it, vi } from 'vitest';
import { combineBbpCurve, curveThroughDrop, savedCurveEndSec } from './roast-curve';
import type { TsvPoint } from './tsv';

vi.mock('@shared/lib/r2', () => ({ fetchTsvFromR2: vi.fn() }));

const point = (t: number, bt = 190): TsvPoint => ({ t, bt, et: 210, ror: 5, heater: 20, fan: 30, drum: 50 });

describe('combined BBP timeline', () => {
    it('aligns each source by its own Charge duration without scaling or mutating stored times', () => {
        const roast = [point(0), point(60)];
        const bbp = [point(2), point(90), point(92, 999)];
        const actual = combineBbpCurve(roast, bbp, 92);
        const reference = combineBbpCurve(roast, bbp, 100);
        expect(actual.points.map((p) => p.t)).toEqual([-90, -2, 0, 60]);
        expect(reference.points.map((p) => p.t)).toEqual([-98, -10, -8, 0, 60]);
        expect(actual.points.map((p) => p.ror)).toEqual([null, null, 5, 5]);
        expect(actual.points.find((p) => p.t === 0)?.bt).toBe(190);
        expect(bbp.map((p) => p.t)).toEqual([2, 90, 92]);
        expect(actual.bbpRange).toEqual({ start: -92, end: 0 });
        expect(combineBbpCurve(roast, bbp).bbpRange).toEqual(actual.bbpRange);
    });

    it('keeps roast unchanged without BBP and can display only BBP when roast is unavailable', () => {
        const roast = [point(0), point(60)];
        expect(combineBbpCurve(roast, [], 92)).toEqual({ points: roast, bbpRange: undefined });
        expect(combineBbpCurve([], [point(2), point(92)], 92).points.map((p) => p.t)).toEqual([-90, 0]);
    });

    it('saved 20-minute BBP sits at -20:00…00:00 with Charge at 00:00', () => {
        const roast = [point(0), point(60)];
        const combined = combineBbpCurve(roast, [point(0), point(1200)], 1200);
        expect(combined.bbpRange).toEqual({ start: -1200, end: 0 });
        expect(combined.points.map((p) => p.t)).toEqual([-1200, 0, 60]);
        expect(combined.points.find((p) => p.t === 0)?.bt).toBe(190);
    });
});

describe('saved curve end', () => {
    const curve = [point(0), point(300), point(540), point(600)];

    it('ends a Drop-terminated record at its Drop mark and leaves the stored samples alone', () => {
        const events = [
            { type: 'Charge', time_sec: 0 },
            { type: 'Drop', time_sec: 540 },
        ];
        expect(savedCurveEndSec(events)).toBe(540);
        const drawn = curveThroughDrop(curve, events);
        expect(drawn.map((p) => p.t)).toEqual([0, 300, 540]);
        expect(drawn[2]).toBe(curve[2]);
        expect(curve).toHaveLength(4);
    });

    it('returns the same array when the curve already ends at Drop', () => {
        expect(curveThroughDrop(curve, [{ type: 'Drop', time_sec: 600 }])).toBe(curve);
        expect(curveThroughDrop(curve, [{ type: 'Drop', time_sec: 900 }])).toBe(curve);
    });

    it('keeps the whole recorded span when the record has an End mark or no usable Drop', () => {
        const withEnd = [
            { type: 'Drop', time_sec: 540 },
            { type: 'End', time_sec: 600 },
        ];
        expect(savedCurveEndSec(withEnd)).toBeNull();
        expect(curveThroughDrop(curve, withEnd)).toBe(curve);
        for (const events of [null, undefined, 'x', [], [{ type: 'Drop' }], [{ type: 'Drop', time_sec: -5 }]]) {
            expect(curveThroughDrop(curve, events)).toBe(curve);
        }
    });

    it('keeps BBP samples before Charge', () => {
        const joined = [point(-120), point(-1), ...curve];
        expect(curveThroughDrop(joined, [{ type: 'Drop', time_sec: 300 }]).map((p) => p.t)).toEqual([-120, -1, 0, 300]);
    });
});
