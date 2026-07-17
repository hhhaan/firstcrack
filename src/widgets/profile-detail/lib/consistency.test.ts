import type { ConsistencySessionRow } from '@entities/roast-profile';
import { describe, expect, it } from 'vitest';
import { computeConsistencyStats } from './consistency';

const row = (drop: number | null, dur: number | null, weight: number): ConsistencySessionRow => ({
    drop_temp_celsius: drop,
    duration_seconds: dur,
    weight_grams: weight,
    roasted_at: null,
});

describe('computeConsistencyStats', () => {
    it('computes per-metric stats in chronological order', () => {
        // newest first: 208 → 204 → 202
        const rows = [row(208, 620, 1000), row(204, 600, 1000), row(202, 610, 1000)];
        const [dropTemp, duration, weight] = computeConsistencyStats(rows);

        expect(dropTemp.values).toEqual([202, 204, 208]);
        expect(dropTemp.n).toBe(3);
        expect(dropTemp.mean).toBeCloseTo(204.67, 1);
        expect(dropTemp.sd).toBeCloseTo(3.06, 1);
        expect(duration.mean).toBe(610);
        expect(weight.sd).toBe(0);
        expect(weight.outlierCount).toBe(0);
    });

    it('skips null values per metric', () => {
        const rows = [row(null, 600, 1000), row(204, null, 1000)];
        const [dropTemp, duration] = computeConsistencyStats(rows);
        expect(dropTemp.values).toEqual([204]);
        expect(dropTemp.n).toBe(1);
        expect(dropTemp.sd).toBeNull();
        expect(duration.values).toEqual([600]);
    });

    it('handles empty input', () => {
        for (const m of computeConsistencyStats([])) {
            expect(m.n).toBe(0);
            expect(m.mean).toBeNull();
        }
    });
});
