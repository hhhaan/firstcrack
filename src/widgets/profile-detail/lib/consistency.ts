import type { ConsistencySessionRow } from '@entities/roast-profile';
import { mean, outlierIndices, stddev } from '@shared/lib/stats';

export const MIN_CONSISTENCY_SESSIONS = 3;

export type ConsistencyMetricKey = 'dropTemp' | 'duration' | 'weight';

export type ConsistencyMetric = {
    key: ConsistencyMetricKey;
    /** 시간순 (oldest → newest) — sparkline용 */
    values: number[];
    n: number;
    mean: number | null;
    sd: number | null;
    outlierCount: number;
};

/** rows는 newest-first (useProfileConsistency 순서) — 내부에서 시간순으로 뒤집는다. */
export const computeConsistencyStats = (rows: ConsistencySessionRow[]): ConsistencyMetric[] => {
    const chronological = [...rows].reverse();
    const metric = (
        key: ConsistencyMetricKey,
        pick: (r: ConsistencySessionRow) => number | null,
    ): ConsistencyMetric => {
        const values = chronological.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
        return {
            key,
            values,
            n: values.length,
            mean: mean(values),
            sd: stddev(values),
            outlierCount: outlierIndices(values).length,
        };
    };
    return [
        metric('dropTemp', (r) => r.drop_temp_celsius),
        metric('duration', (r) => r.duration_seconds),
        metric('weight', (r) => r.weight_grams),
    ];
};
