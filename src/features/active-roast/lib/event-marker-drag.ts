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
    if (!Number.isFinite(timeSec)) return null;
    let best: MarkerDragLivePoint | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const p of livePoints) {
        if (p.time < 0 || !Number.isFinite(p.time) || !Number.isFinite(p.bt)) continue;
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
    logId: string | undefined,
    newTimeSec: number,
    livePoints: ReadonlyArray<MarkerDragLivePoint>,
    unit: TemperatureUnit,
    maxTimeSec: number,
): LogEntry[] {
    if (!logId || !Number.isFinite(newTimeSec) || !Number.isFinite(maxTimeSec) || maxTimeSec < 0) return entries;
    const movedEntry = entries.find((entry) => entry.id === logId);
    if (!movedEntry || movedEntry.event === 'Charge' || movedEntry.event === 'Heater') return entries;

    const boundedTimeSec = Math.min(Math.max(Math.round(newTimeSec), 0), Math.floor(maxTimeSec));
    const newTimeStr = formatElapsed(boundedTimeSec);
    const nearest = nearestLivePointAt(livePoints, boundedTimeSec);

    return entries
        .map((entry) => {
            if (entry.id !== logId) return entry;
            if (!nearest) {
                return { ...entry, time: newTimeStr, timeSec: boundedTimeSec };
            }
            return {
                ...entry,
                time: newTimeStr,
                timeSec: boundedTimeSec,
                temp: formatTemp(nearest.bt, unit),
                tempC: nearest.bt,
            };
        })
        .sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));
}
