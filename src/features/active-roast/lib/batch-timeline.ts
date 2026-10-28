import { formatSignedElapsed } from '@shared/lib/format';
import type { LiveRoastPoint, LogEntry } from '@shared/types/roast';
import { bbpPointsToTsv } from './bbp-archive';
import type { BbpPoint, BbpResult } from './bbp-types';
import { serializeRoastEvents } from './serialize-roast-events';

/** Original wait coordinates and the confirmed boundary belong to one batch. */
export interface BbpCapture {
    sessionId: string;
    generation: string;
    startMs: number;
    chargeMs: number;
    recording: boolean;
    points: BbpPoint[];
    events: LogEntry[];
    /** Higher-frequency waiting observations already collected after the detected Charge. */
    roastLookback?: LiveRoastPoint[];
}

export const captureBatchBbp = (
    wait: {
        active: boolean;
        liveGeneration: string;
        startMs: number;
        recording: boolean;
        points: BbpPoint[];
        events: LogEntry[];
    },
    sessionId: string,
    chargeMs: number,
    lookback: LiveRoastPoint[] = [],
): BbpCapture | null =>
    wait.active
        ? {
              sessionId,
              generation: wait.liveGeneration,
              startMs: wait.startMs,
              chargeMs,
              recording: wait.recording,
              points: structuredClone(wait.points),
              events: structuredClone(wait.events).map((event) => ({ ...event, id: event.id ?? crypto.randomUUID() })),
              roastLookback: lookback.flatMap((point) => {
                  if (point.observedAtMs == null || point.observedAtMs < chargeMs) return [];
                  const time = (point.observedAtMs - chargeMs) / 1000;
                  return [{ ...structuredClone(point), time, label: formatSignedElapsed(time) }];
              }),
          }
        : null;

export const bbpPointToLive = (point: BbpPoint, time = point.t): LiveRoastPoint => ({
    ...point,
    time,
    label: formatSignedElapsed(time),
    ror: null,
    ror_et: time < 0 ? null : (point.ror_et ?? null),
});

/** Split before rounding or serialization, including auto-Charge's already observed tail. */
export const splitBatchBbp = (capture: BbpCapture, windowSeconds = 900) => {
    const cutoff = (capture.chargeMs - capture.startMs) / 1000;
    const origin = Math.max(0, cutoff - windowSeconds);
    const before = capture.points.filter((point) => point.t >= origin && point.t < cutoff);
    const points = before.map((point) => ({ ...point, t: point.t - origin }));
    const events = capture.events.filter((event) => event.timeSec != null && event.timeSec >= origin);
    const beforeEvents = events.filter((event) => (event.timeSec ?? 0) < cutoff);
    const seconds = points.length > 1 ? Math.round(points[points.length - 1].t - points[0].t) : 0;
    const bbp: BbpResult | null =
        capture.recording && (points.length > 0 || beforeEvents.length > 0)
            ? {
                  seconds,
                  chargeTemp: points[points.length - 1]?.bt ?? null,
                  tsv: bbpPointsToTsv(points, cutoff - origin),
                  events: serializeRoastEvents(beforeEvents).map((event) => ({
                      ...event,
                      time_sec: event.time_sec - cutoff,
                  })),
              }
            : null;
    const roastPoints = new Map<number, LiveRoastPoint>();
    for (const point of capture.points) {
        if (point.t >= cutoff)
            roastPoints.set(Math.round((point.t - cutoff) * 1e6), bbpPointToLive(point, point.t - cutoff));
    }
    for (const point of capture.roastLookback ?? []) roastPoints.set(Math.round(point.time * 1e6), point);
    return {
        bbp,
        before,
        roastPoints: [...roastPoints.values()].sort((a, b) => a.time - b.time),
        roastEvents: events.flatMap((event) => {
            const time = (event.timeSec ?? 0) - cutoff;
            return time >= 0 ? [{ ...event, timeSec: time, time: formatSignedElapsed(time) }] : [];
        }),
    };
};

export const batchBbpPoints = (capture: BbpCapture): LiveRoastPoint[] => {
    const cutoff = (capture.chargeMs - capture.startMs) / 1000;
    const origin = Math.max(0, cutoff - 900);
    return capture.points.flatMap((point) =>
        point.t >= origin && point.t < cutoff ? [bbpPointToLive(point, point.t - cutoff)] : [],
    );
};
