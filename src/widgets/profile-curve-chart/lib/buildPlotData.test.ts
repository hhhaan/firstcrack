import { describe, expect, it } from 'vitest';
import { buildProfileCurvePlotData, computeProfileCurveYRange } from './buildPlotData';

/** useSidecarPolling TSV: fractional seconds, not 30s grid */
const fractionalTsvCurve = [
    { t: 0.45, bt: 200 },
    { t: 1.23, bt: 198.5 },
    { t: 2.67, bt: 196 },
    { t: 30.12, bt: 180 },
    { t: 60.89, bt: 165 },
    { t: 90.34, bt: 155 },
];

describe('buildProfileCurvePlotData', () => {
    it('interpolates fractional TSV timestamps onto 30s grid', () => {
        const { xs, ysArrays } = buildProfileCurvePlotData([fractionalTsvCurve]);

        expect(xs).toEqual([0, 30, 60, 90]);
        expect(ysArrays[0]?.every((v) => v != null)).toBe(true);
        expect(ysArrays[0]?.[0]).toBe(200);
        expect(ysArrays[0]?.[1]).toBeCloseTo(180, 0);
    });

    it('returns a zero-time sample with null BT when curve is empty', () => {
        const { xs, ysArrays } = buildProfileCurvePlotData([[]]);
        expect(xs).toEqual([0]);
        expect(ysArrays[0]).toEqual([null]);
    });
});

describe('computeProfileCurveYRange', () => {
    it('fits range to curve min/max with padding', () => {
        const range = computeProfileCurveYRange([
            [
                { t: 0, bt: 210 },
                { t: 60, bt: 175 },
                { t: 120, bt: 205 },
            ],
        ]);
        expect(range[0]).toBeLessThan(175);
        expect(range[1]).toBeGreaterThan(210);
    });

    it('expands beyond fixed 140–230 when curve exceeds it', () => {
        const range = computeProfileCurveYRange([
            [
                { t: 0, bt: 235 },
                { t: 60, bt: 128 },
            ],
        ]);
        expect(range[0]).toBeLessThan(140);
        expect(range[1]).toBeGreaterThan(230);
    });
});
