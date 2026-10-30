import { bbpEventsForDisplay, bbpEventsFromDisplay } from '@features/active-roast/lib/bbp-events';
import { NEAREST_BT_MAX_SEC } from '@features/active-roast/lib/chart-option/markers';
import {
    applyEventMarkerEdit,
    type EventMarkerPatch,
    nearestLivePointAt,
} from '@features/active-roast/lib/event-marker-drag';
import type { CompletedRoastSnapshot } from '@features/active-roast/model/batch';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import type { RoastingState, RoastPhase } from '@features/active-roast/model/status';
import { formatElapsed } from '@shared/lib/format';
import type { LiveRoastPoint, LogEntry } from '@shared/types/roast';

export type TimelineRoastState = Pick<
    RoastingState,
    'phase' | 'elapsed' | 'livePoints' | 'sessionId' | 'bbpCapture'
> & {
    snapshot: CompletedRoastSnapshot | null;
    restore: NonNullable<RoastingState['completed']>['restore'] | undefined;
    entries: LogEntry[];
    rawBT: number | null;
};

type Source =
    | { kind: 'review'; snapshot: CompletedRoastSnapshot }
    | { kind: 'bbp'; points: LiveRoastPoint[]; nowSec: number; origin: number }
    | { kind: 'live'; phase: RoastPhase; points: LiveRoastPoint[]; elapsed: number; waitOffset: number | null };

type Geometry = {
    points: LiveRoastPoint[];
    maxTimeSec: number;
    displayEntries: (entries: LogEntry[]) => LogEntry[];
    editEntries: (entries: LogEntry[], id: string, patch: EventMarkerPatch) => LogEntry[];
    noteAt: (timeSec: number) => { timeSec: number; tempC: number | null };
    noteNow: () => { timeSec: number; tempC: number | null };
};

export type TimelineEditingContext = Geometry &
    ({ kind: 'review' } | { kind: 'bbp' } | { kind: 'live'; phase: RoastPhase; waiting: boolean });

export const dropWaitOffsetFor = (state: TimelineRoastState): number | null => {
    if (state.phase === 'roasting' || state.phase === 'ended' || !state.restore) return null;
    const observation = state.livePoints.find((point) => point.observedAtMs != null);
    return observation?.observedAtMs != null
        ? (observation.observedAtMs - observation.time * 1000 - state.restore.roastStartMs) / 1000
        : state.restore.elapsed;
};

/** Coordinates are private to the timeline; writes still belong to the existing editor. */
export const createTimelineEditing = (
    source: Source,
    unit: TemperatureUnit,
    rawBT: number | null,
): TimelineEditingContext => {
    const points = source.kind === 'review' ? source.snapshot.livePoints : source.points;
    const origin = source.kind === 'bbp' ? source.origin : source.kind === 'live' ? source.waitOffset : null;
    const maxTimeSec =
        source.kind === 'review'
            ? source.snapshot.elapsed
            : source.kind === 'bbp'
              ? Math.max(0, source.nowSec - source.origin)
              : source.waitOffset != null
                ? (points[points.length - 1]?.time ?? 0)
                : source.elapsed;
    const displayEntries = (entries: LogEntry[]) => (origin == null ? entries : bbpEventsForDisplay(entries, origin));
    const temperatureAt = (timeSec: number) => {
        const nearest = nearestLivePointAt(points, timeSec);
        return nearest && Math.abs(nearest.time - timeSec) <= NEAREST_BT_MAX_SEC ? nearest.bt : null;
    };
    const geometry: Geometry = {
        points,
        maxTimeSec,
        displayEntries,
        editEntries: (entries, id, patch) => {
            const next = applyEventMarkerEdit(displayEntries(entries), id, patch, points, unit, maxTimeSec);
            if (origin == null) return next;
            const hidden = entries.filter((entry) =>
                entry.timeSec == null ? source.kind !== 'bbp' : entry.timeSec < origin,
            );
            const restored =
                source.kind === 'bbp'
                    ? bbpEventsFromDisplay(next, origin)
                    : next.map((entry) => {
                          const timeSec = (entry.timeSec ?? 0) + origin;
                          return { ...entry, timeSec, time: formatElapsed(timeSec) };
                      });
            return [...hidden, ...restored];
        },
        noteAt: (timeSec) => ({
            // Live Drop-wait appends already translate through retainDropWaitEvents.
            timeSec: source.kind === 'bbp' ? timeSec + source.origin : timeSec,
            tempC: temperatureAt(timeSec),
        }),
        noteNow: () =>
            source.kind === 'bbp'
                ? { timeSec: source.nowSec, tempC: nearestLivePointAt(points, maxTimeSec)?.bt ?? rawBT }
                : { timeSec: Math.max(0, maxTimeSec), tempC: temperatureAt(Math.max(0, maxTimeSec)) },
    };
    if (source.kind === 'review') return { ...geometry, kind: 'review' };
    if (source.kind === 'bbp') return { ...geometry, kind: 'bbp' };
    return { ...geometry, kind: 'live', phase: source.phase, waiting: source.waitOffset != null };
};
