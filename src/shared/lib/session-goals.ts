import { deltaOrNull } from './roast-delta';

/** ponytail: hardcoded bands — settings UI when demand appears (Roast Settings). */
export const GOAL_BANDS = { dropTemp: 2, duration: 30, devTime: 15, devPct: 2 } as const;

export type GoalMetric = {
    actual: number | null | undefined;
    target: number | null | undefined;
    band: number;
};

export type SessionGoalsVerdict = 'pass' | 'fail' | null;

/** Pass iff every comparable metric is inside its band. No comparables → null (no badge). */
export const goalsVerdict = (metrics: GoalMetric[]): SessionGoalsVerdict => {
    let compared = 0;
    for (const m of metrics) {
        const d = deltaOrNull(m.actual, m.target);
        if (d == null) continue;
        compared += 1;
        if (Math.abs(d) > m.band) return 'fail';
    }
    return compared === 0 ? null : 'pass';
};

export const sessionGoalsVerdict = (
    session: {
        profile_id: string | null;
        drop_temp_celsius: number | null;
        duration_seconds: number | null;
    },
    profile:
        | {
              drop_temp_celsius?: number | null;
              duration_sec?: number | null;
              dev_time_sec?: number | null;
              dev_pct?: number | null;
          }
        | null
        | undefined,
    dev: { devTimeSec: number | null; devPct: number | null },
): SessionGoalsVerdict => {
    if (!session.profile_id || !profile) return null;
    return goalsVerdict([
        { actual: session.drop_temp_celsius, target: profile.drop_temp_celsius, band: GOAL_BANDS.dropTemp },
        { actual: session.duration_seconds, target: profile.duration_sec, band: GOAL_BANDS.duration },
        { actual: dev.devTimeSec, target: profile.dev_time_sec, band: GOAL_BANDS.devTime },
        { actual: dev.devPct, target: profile.dev_pct, band: GOAL_BANDS.devPct },
    ]);
};
