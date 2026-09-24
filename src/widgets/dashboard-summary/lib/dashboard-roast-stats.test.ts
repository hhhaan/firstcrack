import { formatDuration } from '@shared/lib/format';
import { describe, expect, it } from 'vitest';
import { averageRoastDurationSec, splitDashboardMonths } from './dashboard-roast-stats';

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
