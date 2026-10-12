import type { LiveRoastPoint } from '../model/useSidecarPolling';

export const CHART_TOTAL_SECS = 780;

/** Live chart row after dedupe/sentinel — no target BT (target is a separate series). */
export type LiveChartRow = {
    time: number;
    btActual: number | null;
    etActual: number | null;
    rorActual: number | null;
    etRorActual: number | null;
};

const emptyRow = (t: number): LiveChartRow => ({
    time: t,
    btActual: null,
    etActual: null,
    rorActual: null,
    etRorActual: null,
});

/**
 * Map live poll points into chart rows (dedupe + axis sentinels).
 * Target profile BT is NOT interpolated here — chart draws target via its own series.
 * xMin is the left axis (0 after Charge — no pre-charge lookback, #433).
 */
export const buildLiveChartData = (
    livePoints: LiveRoastPoint[],
    xMin: number,
    profileDuration: number,
    xMaxFloor: number = CHART_TOTAL_SECS,
    autoExpand = true,
): LiveChartRow[] => {
    const seen = new Set<number>();
    const deduped: LiveChartRow[] = [];
    for (const p of livePoints) {
        if (!autoExpand && (p.time < xMin || p.time > xMaxFloor)) continue;
        const key = Math.round(p.time * 100);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push({
            time: p.time,
            btActual: p.bt,
            etActual: p.et,
            rorActual: p.ror,
            etRorActual: p.ror_et,
        });
    }
    // livePoints are append-ordered; only sort when a rare out-of-order point appears
    for (let i = 1; i < deduped.length; i++) {
        if (deduped[i].time < deduped[i - 1].time) {
            deduped.sort((a, b) => a.time - b.time);
            break;
        }
    }

    const liveMax = livePoints.length > 0 ? livePoints[livePoints.length - 1].time : 0;
    const chartTotalSecs = autoExpand ? Math.max(xMaxFloor, profileDuration, liveMax) : xMaxFloor;
    const needsStart = deduped.length === 0 || deduped[0].time > xMin + 0.5;
    const needsEnd = deduped.length === 0 || deduped[deduped.length - 1].time < chartTotalSecs - 1;
    return [...(needsStart ? [emptyRow(xMin)] : []), ...deduped, ...(needsEnd ? [emptyRow(chartTotalSecs)] : [])];
};
