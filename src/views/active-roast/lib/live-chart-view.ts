import { type BbpCapture, batchBbpPoints, splitBatchBbp } from '@features/active-roast/lib/batch-timeline';
import { BBP_MAX_SECONDS, type BbpPoint, rebaseBbpWindow } from '@features/active-roast/model/bbp';
import type { TsvPoint } from '@shared/lib/tsv';
import type { LiveRoastPoint } from '../model/useSidecarPolling';
import { livePointsFromBbp } from './bbp-live-points';

/** At most this much of the wait stays left of Charge. The chart origin is 0, not this mark. */
export const BBP_LOOKBACK_SECONDS = 600;
export const REFERENCE_ROAST_AHEAD_SECONDS = BBP_MAX_SECONDS - BBP_LOOKBACK_SECONDS;

export type LiveChartView = {
    livePoints: LiveRoastPoint[];
    targetPoints: TsvPoint[];
    xMin: number;
    xMaxFloor: number | undefined;
    bbpRange?: { start: number; end: number };
    /** Subtract from End-relative BBP event times to match the drawn axis. */
    eventTimeOrigin: number;
    /** Extent and zoom. The wait chart's display times already start at 0. */
    axisOrigin: number;
};

const sampleExtent = (points: { t: number }[]) => {
    let min = points[0]?.t ?? 0;
    let max = min;
    for (const p of points) {
        if (p.t < min) min = p.t;
        if (p.t > max) max = p.t;
    }
    return { min, max, span: Math.max(0, max - min) };
};

/** Preserve the measured wait. After Charge, continue that wait only when `joinBbp` is on. */
export const resolveLiveChartView = (input: {
    bbpActive: boolean;
    charged: boolean;
    livePoints: LiveRoastPoint[];
    bbpPoints: BbpPoint[];
    roastTarget: TsvPoint[];
    bbpTarget: TsvPoint[];
    bbpTargetError: boolean;
    bbpCapture?: BbpCapture | null;
    /** Default on. Off starts the charged chart at Charge and leaves the wait chart unchanged. */
    joinBbp?: boolean;
}): LiveChartView => {
    if (input.charged || !input.bbpActive) {
        const capture = input.bbpCapture;
        const showJoinedBbp = !(input.charged && input.joinBbp === false);
        const before = capture && showJoinedBbp ? batchBbpPoints(capture) : [];
        const targetSource = input.bbpTargetError ? [] : input.bbpTarget;
        const targetEnd = targetSource[0]?.bbpChargeOffsetSec ?? sampleExtent(targetSource).max;
        const beforeTarget = targetSource.flatMap((point) =>
            point.t >= targetEnd - BBP_MAX_SECONDS && point.t < targetEnd
                ? [{ ...point, t: point.t - targetEnd, ror: null }]
                : [],
        );
        const start = before[0]?.time ?? 0;
        return {
            livePoints: before.length
                ? [
                      ...before,
                      ...(input.livePoints.length
                          ? input.livePoints
                          : capture
                            ? splitBatchBbp(capture).roastPoints
                            : []),
                  ]
                : input.livePoints,
            targetPoints: before.length ? [...beforeTarget, ...input.roastTarget] : input.roastTarget,
            xMin: Math.min(0, start),
            xMaxFloor: undefined,
            bbpRange: start < 0 ? { start, end: 0 } : undefined,
            eventTimeOrigin: capture && showJoinedBbp ? (capture.chargeMs - capture.startMs) / 1000 : 0,
            axisOrigin: capture && showJoinedBbp ? (capture.chargeMs - capture.startMs) / 1000 : 0,
        };
    }

    const ahead = input.roastTarget.filter((point) => point.t >= 0 && point.t <= REFERENCE_ROAST_AHEAD_SECONDS);
    const source = input.bbpTargetError ? [] : input.bbpTarget;
    const lastT = input.bbpPoints[input.bbpPoints.length - 1]?.t ?? 0;
    if (ahead.length > 0) {
        const eventTimeOrigin = Math.max(0, lastT - BBP_LOOKBACK_SECONDS);
        const seam = lastT - eventTimeOrigin;
        const livePoints = livePointsFromBbp(
            input.bbpPoints.flatMap((point) =>
                point.t >= eventTimeOrigin && point.t <= lastT ? [{ ...point, t: point.t - eventTimeOrigin }] : [],
            ),
        );
        const liveStart = livePoints[0]?.time ?? 0;
        const liveEnd = livePoints[livePoints.length - 1]?.time ?? liveStart;
        const targetEnd = source[0]?.bbpChargeOffsetSec ?? sampleExtent(source).max;
        const referenceBbp = source.flatMap((point) => {
            const time = seam + (point.t - targetEnd);
            return time >= 0 && time < seam ? [{ ...point, t: time, ror: null }] : [];
        });
        const targetPoints = [...referenceBbp, ...ahead.map((point) => ({ ...point, t: seam + point.t }))].sort(
            (a, b) => a.t - b.t,
        );
        return {
            livePoints,
            targetPoints,
            xMin: 0,
            xMaxFloor: BBP_MAX_SECONDS,
            bbpRange: liveEnd > liveStart ? { start: liveStart, end: liveEnd } : undefined,
            eventTimeOrigin,
            axisOrigin: 0,
        };
    }

    const latestSavedT = sampleExtent(source).max;
    const saved = source.filter((p) => p.t >= latestSavedT - BBP_MAX_SECONDS);
    const savedExtent = sampleExtent(saved);
    const targetPoints = saved.map((p) => ({ ...p, t: p.t - savedExtent.min }));
    const windowed = rebaseBbpWindow(input.bbpPoints, lastT);
    const measuredStart = windowed[0]?.t ?? 0;
    const measuredEnd = (windowed[windowed.length - 1]?.t ?? measuredStart) - measuredStart;
    const clipOrigin = Math.max(0, lastT - BBP_MAX_SECONDS);
    const eventTimeOrigin = clipOrigin + measuredStart;

    return {
        livePoints: livePointsFromBbp(windowed.map((p) => ({ ...p, t: p.t - measuredStart }))),
        targetPoints,
        xMin: 0,
        xMaxFloor: BBP_MAX_SECONDS,
        bbpRange: measuredEnd > 0 ? { start: 0, end: measuredEnd } : undefined,
        eventTimeOrigin,
        axisOrigin: eventTimeOrigin,
    };
};
