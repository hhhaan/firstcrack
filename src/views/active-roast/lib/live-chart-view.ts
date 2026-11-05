import { type BbpCapture, batchBbpPoints, splitBatchBbp } from '@features/active-roast/lib/batch-timeline';
import { BBP_MAX_SECONDS, type BbpPoint } from '@features/active-roast/model/bbp';
import type { TsvPoint } from '@shared/lib/tsv';
import type { LiveRoastPoint } from '../model/useSidecarPolling';
import { livePointsFromBbp } from './bbp-live-points';

export type LiveChartView = {
    livePoints: LiveRoastPoint[];
    targetPoints: TsvPoint[];
    xMin: number;
    xMaxFloor: number | undefined;
    /** Fixed upper bound during BBP; roasting uses the growing extent. */
    xMaxFixed?: number;
    bbpRange?: { start: number; end: number };
    /** Subtract from End-relative BBP event times to match the drawn axis. */
    eventTimeOrigin: number;
    /** Absolute wait time subtracted from displayed coordinates, including zoom. */
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

    const source = input.bbpTargetError ? [] : input.bbpTarget;
    const lastT = input.bbpPoints.reduce(
        (latest, point) => (Number.isFinite(point.t) ? Math.max(latest, point.t) : latest),
        0,
    );
    const origin = Math.max(0, lastT - BBP_MAX_SECONDS);
    const seam = lastT - origin;
    const livePoints = livePointsFromBbp(
        input.bbpPoints.flatMap((point) =>
            point.t >= origin && point.t <= lastT ? [{ ...point, t: point.t - origin }] : [],
        ),
    );
    const liveStart = livePoints[0]?.time ?? 0;
    const liveEnd = livePoints[livePoints.length - 1]?.time ?? liveStart;
    const sourceExtent = sampleExtent(source);
    const explicitCharge = source[0]?.bbpChargeOffsetSec;
    const targetEnd =
        explicitCharge != null && Number.isFinite(explicitCharge) && explicitCharge >= sourceExtent.min
            ? explicitCharge
            : sourceExtent.max;
    const targetOrigin = Math.max(0, targetEnd - BBP_MAX_SECONDS);
    const referenceBbp = source.flatMap((point) =>
        point.t >= targetOrigin && point.t <= targetEnd ? [{ ...point, t: point.t - targetOrigin, ror: null }] : [],
    );
    // The complete saved wait stays in place while measurements accumulate independently.
    // Missing/failed BBP references retain the live-wait Charge preview fallback.
    const referenceCharge = referenceBbp.length ? targetEnd - targetOrigin : seam;
    // Preserve every post-Charge reference sample. The chart clips at its viewport.
    const referenceRoast = input.roastTarget.flatMap((point) =>
        point.t >= 0 ? [{ ...point, t: referenceCharge + point.t }] : [],
    );
    return {
        livePoints,
        targetPoints: [...referenceBbp, ...referenceRoast].sort((a, b) => a.t - b.t),
        xMin: 0,
        xMaxFloor: BBP_MAX_SECONDS,
        xMaxFixed: BBP_MAX_SECONDS,
        bbpRange: referenceBbp.length
            ? { start: 0, end: referenceCharge }
            : liveEnd > liveStart
              ? { start: liveStart, end: liveEnd }
              : undefined,
        eventTimeOrigin: origin,
        axisOrigin: origin,
    };
};
