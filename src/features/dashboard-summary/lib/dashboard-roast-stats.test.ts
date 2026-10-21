import { describe, expect, it } from 'vitest';
import { dailyRoastMetrics, splitDashboardMonths } from './dashboard-roast-stats';

describe('splitDashboardMonths', () => {
    it('keeps a local-month boundary session in this month when ISO string order would not', () => {
        const now = new Date(2026, 8, 15, 12, 0, 0);
        const monthStart = new Date(2026, 8, 1);
        const atStart = monthStart.toISOString().replace('.000Z', '+00:00');
        expect(atStart >= monthStart.toISOString()).toBe(false);

        const { thisMonth, lastMonth } = splitDashboardMonths([{ roasted_at: atStart }], now);
        expect(thisMonth).toHaveLength(1);
        expect(lastMonth).toHaveLength(0);
    });
});

describe('dailyRoastMetrics', () => {
    it('groups local days and preserves idle days', () => {
        const now = new Date(2026, 9, 3, 12);
        const at = (day: number) => new Date(2026, 9, day, 1).toISOString();
        const result = dailyRoastMetrics(
            [
                { roasted_at: at(1), weight_grams: 2000 },
                { roasted_at: at(1), weight_grams: 3000 },
                { roasted_at: at(1), weight_grams: 1000 },
                { roasted_at: at(3), weight_grams: 500 },
                { roasted_at: new Date(2026, 8, 30).toISOString(), weight_grams: 9000 },
                { roasted_at: at(4), weight_grams: 9000 },
                { roasted_at: 'invalid', weight_grams: 9000 },
            ],
            now,
        );
        expect(result).toEqual([
            { date: new Date(2026, 9, 1), batches: 3, kgRoasted: 6 },
            { date: new Date(2026, 9, 2), batches: 0, kgRoasted: 0 },
            { date: new Date(2026, 9, 3), batches: 1, kgRoasted: 0.5 },
        ]);
    });

    it('keeps a zero baseline through today when there are no sessions', () => {
        const result = dailyRoastMetrics([], new Date(2026, 0, 1));
        expect(result).toEqual([{ date: new Date(2026, 0, 1), batches: 0, kgRoasted: 0 }]);
    });
});
