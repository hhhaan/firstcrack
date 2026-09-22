import { sessionRoastMetrics } from '@shared/lib/roast-delta';

type RoastDurationSession = {
    events?: unknown;
    duration_seconds?: number | null;
};

/**
 * Mean roast seconds for the dashboard KPI.
 * Same Drop → End → duration_seconds chain as History `시간` (`sessionRoastMetrics`).
 * Missing duration counts as 0 so the denominator stays the month's batch count.
 */
export const averageRoastDurationSeconds = (sessions: readonly RoastDurationSession[]): number => {
    if (sessions.length === 0) return 0;
    let sum = 0;
    for (const session of sessions) {
        sum += sessionRoastMetrics(session).roastDurationSec ?? 0;
    }
    return sum / sessions.length;
};
