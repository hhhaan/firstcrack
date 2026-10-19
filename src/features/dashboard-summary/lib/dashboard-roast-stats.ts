import { sessionRoastMetrics } from '@shared/lib/roast-delta';
import { ymInRange } from '@shared/lib/sessionFilter';

export type RoastDurationSession = {
    events?: unknown;
    /** Record End elapsed. Used only when Drop and End marks are missing. */
    duration_seconds?: number | null;
};

const localYM = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Mean History `시간`: Charge→Drop via `sessionRoastMetrics` (Drop, else End, else duration_seconds).
 * Sessions with no duration are omitted so they don't pull the mean toward 0.
 */
export const averageRoastDurationSec = (sessions: RoastDurationSession[]): number => {
    let sum = 0;
    let n = 0;
    for (const session of sessions) {
        const sec = sessionRoastMetrics(session).roastDurationSec;
        if (sec == null) continue;
        sum += sec;
        n += 1;
    }
    return n > 0 ? sum / n : 0;
};

/** Local calendar month, same predicate as History `ymInRange` (not ISO string order). */
export const splitDashboardMonths = <T extends { roasted_at: string }>(
    sessions: T[],
    now: Date,
): { thisMonth: T[]; lastMonth: T[] } => {
    const thisYM = localYM(now);
    const lastYM = localYM(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    return {
        thisMonth: sessions.filter((s) => ymInRange(s.roasted_at, thisYM, thisYM)),
        lastMonth: sessions.filter((s) => ymInRange(s.roasted_at, lastYM, lastYM)),
    };
};

export interface DailyRoastMetric {
    date: Date;
    batches: number;
    kgRoasted: number;
    avgDurationSeconds: number | null;
}

/** Local calendar days through today; a missing duration remains a gap, not a zero-second roast. */
export const dailyRoastMetrics = (
    sessions: (RoastDurationSession & { roasted_at: string; weight_grams: number })[],
    now: Date,
): DailyRoastMetric[] => {
    const days = Array.from({ length: now.getDate() }, (_, index) => ({
        date: new Date(now.getFullYear(), now.getMonth(), index + 1),
        batches: 0,
        kgRoasted: 0,
        durationSum: 0,
        durationCount: 0,
    }));

    for (const session of sessions) {
        const date = new Date(session.roasted_at);
        if (
            !Number.isFinite(date.getTime()) ||
            date.getFullYear() !== now.getFullYear() ||
            date.getMonth() !== now.getMonth() ||
            date > now
        )
            continue;
        const day = days[date.getDate() - 1];
        day.batches += 1;
        day.kgRoasted += session.weight_grams / 1000;
        const duration = sessionRoastMetrics(session).roastDurationSec;
        if (duration != null) {
            day.durationSum += duration;
            day.durationCount += 1;
        }
    }

    return days.map(({ date, batches, kgRoasted, durationSum, durationCount }) => ({
        date,
        batches,
        kgRoasted,
        avgDurationSeconds: durationCount > 0 ? durationSum / durationCount : null,
    }));
};
