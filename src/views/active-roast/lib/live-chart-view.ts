import { type BbpCapture, batchBbpPoints, splitBatchBbp } from '@features/active-roast/lib/batch-timeline';
import { BBP_MAX_SECONDS, type BbpPoint, rebaseBbpWindow } from '@features/active-roast/model/bbp';
import type { TsvPoint } from '@shared/lib/tsv';
import type { LiveRoastPoint } from '../model/useSidecarPolling';
import { livePointsFromBbp } from './bbp-live-points';

export type LiveChartView = {
    livePoints: LiveRoastPoint[];
    targetPoints: TsvPoint[];
    xMin: number;
    xMaxFloor: number | undefined;
    bbpRange?: { start: number; end: number };
    /** Subtract from End-relative BBP event times to match the drawn 0-based axis. */
    eventTimeOrigin: number;
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

/** Preserve the measured wait, then continue in Charge-relative coordinates. */
export const resolveLiveChartView = (input: {
    bbpActive: boolean;
    charged: boolean;
    livePoints: LiveRoastPoint[];
    bbpPoints: BbpPoint[];
    roastTarget: TsvPoint[];
    bbpTarget: TsvPoint[];
    bbpTargetError: boolean;
    bbpCapture?: BbpCapture | null;
}): LiveChartView => {
    if (input.charged || !input.bbpActive) {
        const capture = input.bbpCapture;
        const before = capture ? batchBbpPoints(capture) : [];
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
            eventTimeOrigin: capture ? (capture.chargeMs - capture.startMs) / 1000 : 0,
        };
    }

    const source = input.bbpTargetError ? [] : input.bbpTarget;
    const latestSavedT = sampleExtent(source).max;
    const saved = source.filter((p) => p.t >= latestSavedT - BBP_MAX_SECONDS);
    const savedExtent = sampleExtent(saved);
    const targetPoints = saved.map((p) => ({ ...p, t: p.t - savedExtent.min }));
    const lastT = input.bbpPoints[input.bbpPoints.length - 1]?.t ?? 0;
    const windowed = rebaseBbpWindow(input.bbpPoints, lastT);
    const measuredStart = windowed[0]?.t ?? 0;
    const measuredEnd = (windowed[windowed.length - 1]?.t ?? measuredStart) - measuredStart;
    const clipOrigin = Math.max(0, lastT - BBP_MAX_SECONDS);

    return {
        livePoints: livePointsFromBbp(windowed.map((p) => ({ ...p, t: p.t - measuredStart }))),
        targetPoints,
        xMin: 0,
        xMaxFloor: BBP_MAX_SECONDS,
        bbpRange: measuredEnd > 0 ? { start: 0, end: measuredEnd } : undefined,
        eventTimeOrigin: clipOrigin + measuredStart,
    };
};
