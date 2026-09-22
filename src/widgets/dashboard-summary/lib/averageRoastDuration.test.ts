import { formatDuration } from '@shared/lib/format';
import { describe, expect, it } from 'vitest';
import { averageRoastDurationSeconds } from './averageRoastDuration';

/** #531 QA: History `시간` (Charge→Drop) for this month's 12 batches. Mean 258.75s → 4:19. */
const HISTORY_CHARGE_DROP_SEC = [6, 393, 1, 122, 250, 234, 42, 124, 803, 5, 1058, 67];

const sessionsWithRecordingTail = HISTORY_CHARGE_DROP_SEC.map((drop) => ({
    events: [
        { type: 'Charge', time_sec: 0 },
        { type: 'Drop', time_sec: drop },
        { type: 'End', time_sec: drop + 1 },
    ],
    duration_seconds: drop + 1,
}));

describe('averageRoastDurationSeconds', () => {
    it('averages History Charge→Drop, not record duration_seconds (#531)', () => {
        const avg = averageRoastDurationSeconds(sessionsWithRecordingTail);
        expect(avg).toBe(258.75);
        expect(formatDuration(avg)).toBe('4:19');

        const recordAvg =
            sessionsWithRecordingTail.reduce((acc, s) => acc + s.duration_seconds, 0) /
            sessionsWithRecordingTail.length;
        expect(formatDuration(recordAvg)).toBe('4:20');
    });

    it('falls back to duration_seconds when Drop and End are missing', () => {
        expect(
            averageRoastDurationSeconds([
                { events: [], duration_seconds: 120 },
                { events: null, duration_seconds: 180 },
            ]),
        ).toBe(150);
    });

    it('counts a missing duration as 0 so the denominator stays the batch count', () => {
        expect(
            averageRoastDurationSeconds([
                { events: [], duration_seconds: null },
                { events: [{ type: 'Drop', time_sec: 100 }], duration_seconds: 130 },
            ]),
        ).toBe(50);
    });

    it('returns 0 for an empty month', () => {
        expect(averageRoastDurationSeconds([])).toBe(0);
    });
});
