import { ymInRange } from '@shared/lib/sessionFilter';

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
