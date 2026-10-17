import { describe, expect, it } from 'vitest';
import { convergeTolerance, heaterScale } from './controlScale';

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
});
