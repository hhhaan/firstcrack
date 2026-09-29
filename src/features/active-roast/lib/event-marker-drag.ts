import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { formatElapsed } from '@shared/lib/format';
import type { LogEntry, RoastNoteControls } from '@shared/types/roast';
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

export type EventMarkerPatch = RoastNoteControls & {
    timeSec?: number;
    note?: string;
};

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
    return applyEventMarkerEdit(entries, logId, { timeSec: newTimeSec }, livePoints, unit, maxTimeSec);
}

/**
 * Patch a log event from the chart editor. Charge stays immutable.
 * Time changes snap BT to the nearest live sample. Note applies to Heater/Note only.
 */
export function applyEventMarkerEdit(
    entries: LogEntry[],
    logId: string | undefined,
    patch: EventMarkerPatch,
    livePoints: ReadonlyArray<MarkerDragLivePoint>,
    unit: TemperatureUnit,
    maxTimeSec: number,
): LogEntry[] {
    if (!logId) return entries;
    const target = entries.find((entry) => entry.id === logId);
    if (!target || target.event === 'Charge') return entries;

    const nextTimeSec = patch.timeSec;
    const nextNote = patch.note;
    const hasTime = nextTimeSec != null;
    const allowNote = (target.event === 'Heater' || target.event === 'Note') && nextNote != null;
    const allowControls = target.event === 'Note' && (patch.gas !== undefined || patch.airflow !== undefined);
    if (!hasTime && !allowNote && !allowControls) return entries;
    if (
        hasTime &&
        (nextTimeSec == null || !Number.isFinite(nextTimeSec) || !Number.isFinite(maxTimeSec) || maxTimeSec < 0)
    )
        return entries;

    const boundedTimeSec =
        hasTime && nextTimeSec != null
            ? Math.min(Math.max(Math.round(nextTimeSec), 0), Math.floor(maxTimeSec))
            : logEntryTimeSec(target);

    return entries
        .map((entry) => {
            if (entry.id !== logId) return entry;
            const next = allowNote && nextNote != null ? { ...entry, note: nextNote } : { ...entry };
            if (allowControls) {
                if (patch.gas !== undefined) next.gas = patch.gas.trim() || undefined;
                if (patch.airflow !== undefined) next.airflow = patch.airflow.trim() || undefined;
            }
            if (!hasTime) return next;
            const newTimeStr = formatElapsed(boundedTimeSec);
            const nearest = nearestLivePointAt(livePoints, boundedTimeSec);
            if (!nearest) return { ...next, time: newTimeStr, timeSec: boundedTimeSec };
            return {
                ...next,
                time: newTimeStr,
                timeSec: boundedTimeSec,
                temp: formatTemp(nearest.bt, unit),
                tempC: nearest.bt,
            };
        })
        .sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));
}
