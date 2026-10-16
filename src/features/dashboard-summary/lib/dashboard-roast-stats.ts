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
