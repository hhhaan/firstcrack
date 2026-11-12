import { describe, expect, it } from 'vitest';
import { convergeTolerance, heaterScale } from './controlScale';
import { showLiveFollow } from './snapPercent';

describe('controlScale display settling', () => {
    it.each([undefined, null, 0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
        'uses a percent scale for invalid max %s',
        (max) => {
            expect(heaterScale(max)).toBe(100);
            expect(convergeTolerance(max)).toBe(1);
        },
    );

    it.each([
        [10, 1],
        [100, 1],
        [200, 2],
    ])('settles a %i scale within %i units', (max, tolerance) => {
        expect(convergeTolerance(max)).toBe(tolerance);
    });

    it('matches HeaterScale live-follow tolerance on a 0–200 heater', () => {
        const max = 200;
        const tolerance = convergeTolerance(max);
        expect(tolerance).toBe(2);
        expect(showLiveFollow(100, 98, 1)).toBe(true);
        expect(showLiveFollow(100, 98, tolerance)).toBe(false);
    });
});
