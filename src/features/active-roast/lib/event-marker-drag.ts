import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { formatElapsed } from '@shared/lib/format';
import type { LogEntry, RoastNoteControls } from '@shared/types/roast';
import { NEAREST_BT_MAX_SEC } from './chart-option/markers';
import { parseControlMarkerLogId } from './fan-drum-markers';
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
    tempC?: number;
    note?: string;
};

/** Resolve repeated temperatures on the branch closest to the event being edited. */
function liveTimeAtTemperature(
    livePoints: ReadonlyArray<MarkerDragLivePoint>,
    tempC: number,
    nearTimeSec: number,
    maxTimeSec: number,
): number | null {
    if (!Number.isFinite(tempC) || !Number.isFinite(nearTimeSec) || !Number.isFinite(maxTimeSec) || maxTimeSec < 0)
        return null;
    const points = livePoints
        .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.bt) && p.time >= 0 && p.time <= maxTimeSec)
        .sort((a, b) => a.time - b.time);
    let best: number | null = null;
    const consider = (time: number) => {
        if (best == null || Math.abs(time - nearTimeSec) < Math.abs(best - nearTimeSec)) best = time;
    };
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        if (point.bt === tempC) consider(point.time);
        const previous = points[i - 1];
        if (!previous || previous.bt === point.bt || point.time - previous.time > NEAREST_BT_MAX_SEC * 2) continue;
        const ratio = (tempC - previous.bt) / (point.bt - previous.bt);
        if (ratio >= 0 && ratio <= 1) consider(previous.time + ratio * (point.time - previous.time));
    }
    return best == null ? null : Math.round(best);
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
    return applyEventMarkerEdit(entries, logId, { timeSec: newTimeSec }, livePoints, unit, maxTimeSec);
}

/** Move the saved turning point, or insert one, from a chart drag. Record only. */
export function upsertReviewTurningPoint(
    entries: LogEntry[],
    timeSec: number,
    livePoints: ReadonlyArray<MarkerDragLivePoint>,
    unit: TemperatureUnit,
    maxTimeSec: number,
): LogEntry[] {
    const existing = entries.find((entry) => entry.event === 'TP' && entry.id);
    if (existing?.id) return applyEventMarkerDrag(entries, existing.id, timeSec, livePoints, unit, maxTimeSec);
    if (!Number.isFinite(timeSec) || !Number.isFinite(maxTimeSec) || maxTimeSec < 0) return entries;
    const bounded = Math.min(Math.max(Math.round(timeSec), 0), Math.floor(maxTimeSec));
    const nearest = nearestLivePointAt(livePoints, bounded);
    if (!nearest || Math.abs(nearest.time - bounded) > NEAREST_BT_MAX_SEC) return entries;
    const next: LogEntry = {
        id: crypto.randomUUID(),
        time: formatElapsed(bounded),
        timeSec: bounded,
        event: 'TP',
        temp: formatTemp(nearest.bt, unit),
        tempC: nearest.bt,
        note: '',
    };
    return [...entries, next].sort((a, b) => (logEntryTimeSec(a) ?? 0) - (logEntryTimeSec(b) ?? 0));
}

/**
 * Patch an event from the chart or log editor. Charge stays immutable.
 * Time changes snap BT to a sample; temperature changes resolve the closest curve crossing.
 * Note applies to Heater/Note only.
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
    const controlMark = parseControlMarkerLogId(logId);
    const target = entries.find((entry) => entry.id === (controlMark?.id ?? logId));
    if (!target || target.current || target.event === 'Charge') return entries;
    if (controlMark) {
        if (target.event !== 'Control') return entries;
        const nextValue = patch.note == null ? undefined : Number(patch.note);
        if (patch.note != null && !Number.isFinite(nextValue)) return entries;
        const nextTimeSec = patch.timeSec;
        const hasTime = nextTimeSec != null;
        if (
            hasTime &&
            (nextTimeSec == null || !Number.isFinite(nextTimeSec) || !Number.isFinite(maxTimeSec) || maxTimeSec < 0)
        )
            return entries;
        if (!hasTime && nextValue == null) return entries;
        return entries
            .map((entry) => {
                if (entry.id !== target.id) return entry;
                const applied = { ...entry.appliedControl };
                if (nextValue != null) applied[controlMark.role] = nextValue;
                if (!hasTime || nextTimeSec == null) return { ...entry, appliedControl: applied };
                const boundedTimeSec = Math.max(0, Math.round(nextTimeSec));
                return {
                    ...entry,
                    appliedControl: applied,
                    time: formatElapsed(boundedTimeSec),
                    timeSec: boundedTimeSec,
                };
            })
            .sort((a, b) => (logEntryTimeSec(a) ?? 0) - (logEntryTimeSec(b) ?? 0));
    }

    const nextTemp = patch.tempC;
    const hasTemp = nextTemp !== undefined;
    const nearTimeSec = patch.timeSec ?? logEntryTimeSec(target);
    const nextTimeSec =
        nextTemp !== undefined
            ? nearTimeSec != null
                ? liveTimeAtTemperature(livePoints, nextTemp, nearTimeSec, maxTimeSec)
                : null
            : patch.timeSec;
    if (hasTemp && nextTimeSec == null) return entries;
    const nextNote = patch.note;
    const hasTime = nextTimeSec != null;
    const allowNote = (target.event === 'Heater' || target.event === 'Note') && nextNote != null;
    const allowControls =
        target.event === 'Note' && (patch.gas !== undefined || patch.airflow !== undefined || patch.drum !== undefined);
    if (!hasTime && !allowNote && !allowControls) return entries;
    if (
        hasTime &&
        (nextTimeSec == null || !Number.isFinite(nextTimeSec) || !Number.isFinite(maxTimeSec) || maxTimeSec < 0)
    )
        return entries;

    return entries
        .map((entry) => {
            if (entry.id !== logId) return entry;
            const next = allowNote && nextNote != null ? { ...entry, note: nextNote } : { ...entry };
            if (allowControls) {
                if (patch.gas !== undefined) next.gas = patch.gas.trim() || undefined;
                if (patch.airflow !== undefined) next.airflow = patch.airflow.trim() || undefined;
                if (patch.drum !== undefined) next.drum = patch.drum.trim() || undefined;
            }
            if (!hasTime || nextTimeSec == null) return next;
            const boundedTimeSec =
                target.event === 'Note'
                    ? Math.max(0, Math.round(nextTimeSec))
                    : Math.min(Math.max(Math.round(nextTimeSec), 0), Math.floor(maxTimeSec));
            const newTimeStr = formatElapsed(boundedTimeSec);
            const nearest = nearestLivePointAt(livePoints, boundedTimeSec);
            const close = nearest != null && Math.abs(nearest.time - boundedTimeSec) <= NEAREST_BT_MAX_SEC;
            if (target.event === 'Note' && !close) {
                return { ...next, time: newTimeStr, timeSec: boundedTimeSec, temp: '', tempC: null };
            }
            if (!nearest) return { ...next, time: newTimeStr, timeSec: boundedTimeSec };
            return {
                ...next,
                time: newTimeStr,
                timeSec: boundedTimeSec,
                temp: formatTemp(nextTemp ?? nearest.bt, unit),
                tempC: nextTemp ?? nearest.bt,
            };
        })
        .sort((a, b) => (logEntryTimeSec(a) ?? 0) - (logEntryTimeSec(b) ?? 0));
}
