import { describe, expect, it, vi } from 'vitest';
import { combineBbpCurve } from './roast-curve';
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
});
