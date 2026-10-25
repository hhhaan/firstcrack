import { ymInRange } from '@shared/lib/sessionFilter';
import { endOfMonth, isSameMonth } from 'date-fns';

const localYM = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

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
}

/** Local calendar days through today, including days without roasts. */
export const dailyRoastMetrics = (
    sessions: { roasted_at: string; weight_grams: number }[],
    now: Date,
): DailyRoastMetric[] => {
    const days = Array.from({ length: now.getDate() }, (_, index) => ({
        date: new Date(now.getFullYear(), now.getMonth(), index + 1),
        batches: 0,
        kgRoasted: 0,
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
    }

    return days;
};

/** Selected calendar month against the month before it. Current month stops at `now`. */
export const dashboardMonthStats = <T extends { roasted_at: string | null; weight_grams: number }>(
    sessions: T[],
    month: Date,
    now = new Date(),
) => {
    const asOf = isSameMonth(month, now) ? now : endOfMonth(month);
    const completed = sessions.filter((session): session is T & { roasted_at: string } => !!session.roasted_at);
    const { thisMonth, lastMonth } = splitDashboardMonths(completed, asOf);
    const sumKg = (rows: typeof completed) => rows.reduce((acc, session) => acc + session.weight_grams, 0) / 1000;
    return {
        batchesThisMonth: thisMonth.length,
        batchesLastMonth: lastMonth.length,
        kgRoastedThisMonth: sumKg(thisMonth),
        kgRoastedLastMonth: sumKg(lastMonth),
        dailyMetrics: dailyRoastMetrics(thisMonth, asOf),
    };
};
