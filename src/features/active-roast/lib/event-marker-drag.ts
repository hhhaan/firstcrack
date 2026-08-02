import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { formatElapsed } from '@shared/lib/format';
import type { LogEntry } from '@shared/types/roast';
import { logEntryTimeSec } from './serialize-roast-events';
import { formatTemp } from './temperature';

export type MarkerDragLivePoint = {
    time: number;
    bt: number;
};

/** Nearest live curve sample by absolute time distance (charge-relative sec). */
export function nearestLivePointAt(
    livePoints: ReadonlyArray<MarkerDragLivePoint>,
    timeSec: number,
): MarkerDragLivePoint | null {
    if (livePoints.length === 0) return null;
    let best: MarkerDragLivePoint | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const p of livePoints) {
        const d = Math.abs(p.time - timeSec);
        if (d < bestDist) {
            bestDist = d;
            best = p;
        }
    }
    return best;
}

/**
 * Apply chart event-marker drag: sync time + BT from nearest live sample, re-sort by time.
 * Pure — unit-tested without rendering the chart.
 */
export function applyEventMarkerDrag(
    entries: LogEntry[],
    event: string,
    newTimeSec: number,
    livePoints: ReadonlyArray<MarkerDragLivePoint>,
    unit: TemperatureUnit,
): LogEntry[] {
    const newTimeStr = formatElapsed(newTimeSec);
    const nearest = nearestLivePointAt(livePoints, newTimeSec);

    return entries
        .map((entry) => {
            if (entry.event !== event) return entry;
            if (!nearest) {
                return { ...entry, time: newTimeStr, timeSec: newTimeSec };
            }
            return {
                ...entry,
                time: newTimeStr,
                timeSec: newTimeSec,
                temp: formatTemp(nearest.bt, unit),
                tempC: nearest.bt,
            };
        })
        .sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));
}
