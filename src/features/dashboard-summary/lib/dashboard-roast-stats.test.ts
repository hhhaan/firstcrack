import { formatDuration } from '@shared/lib/format';
import { describe, expect, it } from 'vitest';
import { averageRoastDurationSec, dailyRoastMetrics, splitDashboardMonths } from './dashboard-roast-stats';

/** History 시간 column for the #531 month (12 rows). Mean 3105/12 = 258.75s → 4:19. */
const HISTORY_CHARGE_TO_DROP_SEC = [6, 393, 1, 122, 250, 234, 42, 124, 803, 5, 1058, 67];

const session = (dropSec: number, durationSeconds: number | null) => ({
    duration_seconds: durationSeconds,
    events: [{ type: 'Drop', time_sec: dropSec }],
});

describe('averageRoastDurationSec', () => {
    it('averages Charge→Drop and formats as History 시간 (4:19), not record-end 4:20', () => {
        // Recording continues ~1s after Drop. Mean of duration_seconds is 259.75 → formatDuration 4:20.
        const sessions = HISTORY_CHARGE_TO_DROP_SEC.map((drop) => session(drop, drop + 1));
        const avg = averageRoastDurationSec(sessions);
        expect(avg).toBeCloseTo(3105 / 12);
        expect(formatDuration(avg)).toBe('4:19');
    });

    it('falls back to End, then duration_seconds, when Drop is missing', () => {
        expect(
            averageRoastDurationSec([
                { duration_seconds: 660, events: [{ type: 'End', time_sec: 600 }] },
                { duration_seconds: 120, events: [] },
            ]),
        ).toBe(360);
    });

    it('omits sessions with no roast duration instead of counting them as zero', () => {
        expect(averageRoastDurationSec([{ duration_seconds: null, events: [] }, session(120, 180)])).toBe(120);
        expect(averageRoastDurationSec([])).toBe(0);
    });
});

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
    it('groups local days, preserves idle days, and averages Charge→Drop without missing durations', () => {
        const now = new Date(2026, 9, 3, 12);
        const at = (day: number) => new Date(2026, 9, day, 1).toISOString();
        const result = dailyRoastMetrics(
            [
                { ...session(120, 150), roasted_at: at(1), weight_grams: 2000 },
                { ...session(240, 270), roasted_at: at(1), weight_grams: 3000 },
                { events: [], duration_seconds: null, roasted_at: at(1), weight_grams: 1000 },
                { events: [], duration_seconds: null, roasted_at: at(3), weight_grams: 500 },
                { ...session(600, 660), roasted_at: new Date(2026, 8, 30).toISOString(), weight_grams: 9000 },
                { ...session(600, 660), roasted_at: at(4), weight_grams: 9000 },
                { ...session(600, 660), roasted_at: 'invalid', weight_grams: 9000 },
            ],
            now,
        );
        expect(result).toEqual([
            { date: new Date(2026, 9, 1), batches: 3, kgRoasted: 6, avgDurationSeconds: 180 },
            { date: new Date(2026, 9, 2), batches: 0, kgRoasted: 0, avgDurationSeconds: null },
            { date: new Date(2026, 9, 3), batches: 1, kgRoasted: 0.5, avgDurationSeconds: null },
        ]);
    });

    it('keeps a zero baseline through today when there are no sessions', () => {
        const result = dailyRoastMetrics([], new Date(2026, 0, 1));
        expect(result).toEqual([{ date: new Date(2026, 0, 1), batches: 0, kgRoasted: 0, avgDurationSeconds: null }]);
    });
});
