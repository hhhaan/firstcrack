import type { TsvPoint } from '@shared/lib/tsv';
import { describe, expect, it } from 'vitest';
import {
    referenceCurveFromPoints,
    referenceCurveInRange,
    referenceHasControls,
    toDisplayReferenceCurve,
} from './reference-curve';

const point = (overrides: Partial<TsvPoint> & Pick<TsvPoint, 't' | 'bt'>): TsvPoint => ({
    et: null,
    ror: null,
    heater: null,
    fan: null,
    drum: null,
    ...overrides,
});

describe('referenceCurveFromPoints', () => {
    it('keeps stored channels, including zeros, and does not copy heaterSet or invent gaps', () => {
        const curve = referenceCurveFromPoints([
            point({ t: 0, bt: 100, et: 110, ror: 5, heater: 40, fan: 0, drum: 50, heaterSet: 80 }),
            point({ t: 30, bt: 120, et: null, ror: null, heater: null, fan: null, drum: null }),
            point({ t: 60, bt: 140, et: Number.NaN, ror: Number.POSITIVE_INFINITY, heater: 0, fan: 12, drum: 55 }),
        ]);
        expect(curve).toEqual([
            { time: 0, bt: 100, et: 110, ror: 5, heater: 40, fan: 0, drum: 50 },
            { time: 30, bt: 120, et: null, ror: null, heater: null, fan: null, drum: null },
            { time: 60, bt: 140, et: null, ror: null, heater: 0, fan: 12, drum: 55 },
        ]);
        expect(curve[0]).not.toHaveProperty('heaterSet');
        expect(referenceHasControls(curve)).toBe(true);
    });

    it('treats a BT-only synthetic profile as having no other channels', () => {
        const curve = referenceCurveFromPoints([point({ t: 0, bt: 200, heaterSet: 90 })]);
        expect(curve).toEqual([{ time: 0, bt: 200, et: null, ror: null, heater: null, fan: null, drum: null }]);
        expect(referenceHasControls(curve)).toBe(false);
    });

    it('filters the shared time axis and converts only temperature channels', () => {
        const curve = referenceCurveFromPoints([
            point({ t: -30, bt: 200, et: 210, heater: 10, drum: 40 }),
            point({ t: 0, bt: 100, et: 110, ror: 0, heater: 20, fan: 0, drum: 40 }),
            point({ t: 60, bt: 120, ror: 5, fan: 30 }),
        ]);
        expect(referenceCurveInRange(curve, { start: 0, end: 30 }).map((p) => p.time)).toEqual([0]);
        expect(referenceCurveInRange(curve, null)).toBe(curve);
        const display = toDisplayReferenceCurve(curve, 'F');
        expect(display.xs).toEqual([-30, 0, 60]);
        expect(display.bt).toEqual([392, 212, 248]);
        expect(display.et).toEqual([410, 230, null]);
        expect(display.ror).toEqual([null, 0, 9]);
        expect(display.heater).toEqual([10, 20, null]);
        expect(display.fan).toEqual([null, 0, 30]);
        expect(display.drum).toEqual([40, 40, null]);
    });
});
