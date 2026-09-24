import { BBP_MAX_SECONDS, type BbpPoint, rebaseBbpWindow } from '@features/active-roast/model/bbp';
import { combineBbpCurve } from '@shared/lib/roast-curve';
import type { TsvPoint } from '@shared/lib/tsv';
import type { LiveRoastPoint } from '../model/useSidecarPolling';
import { livePointsFromBbp, shiftLivePoints } from './bbp-live-points';

export type LiveChartView = {
    livePoints: LiveRoastPoint[];
    targetPoints: TsvPoint[];
    xMin: number;
    xMaxFloor: number | undefined;
    bbpRange?: { start: number; end: number };
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

/** Charge 전: 타깃 점선(BBP+로스팅) + 현재 온도. Charge 후: 00:00 로스팅만 (#433). */
export const resolveLiveChartView = (input: {
    bbpActive: boolean;
    charged: boolean;
    livePoints: LiveRoastPoint[];
    bbpPoints: BbpPoint[];
    roastTarget: TsvPoint[];
    bbpTarget: TsvPoint[];
    bbpTargetError: boolean;
}): LiveChartView => {
    if (!(input.bbpActive || !input.charged)) {
        return {
            livePoints: input.livePoints,
            targetPoints: input.roastTarget,
            xMin: 0,
            xMaxFloor: undefined,
        };
    }

    const source = input.bbpTargetError ? [] : input.bbpTarget;
    const latestSavedT = sampleExtent(source).max;
    const saved = source.filter((p) => p.t >= latestSavedT - BBP_MAX_SECONDS);
    const savedExtent = sampleExtent(saved);
    const combined = combineBbpCurve(
        input.roastTarget,
        saved.map((p) => ({ ...p, t: p.t - savedExtent.min })),
    );
    const lastT = input.bbpPoints[input.bbpPoints.length - 1]?.t ?? 0;
    const windowed = input.bbpActive ? rebaseBbpWindow(input.bbpPoints, lastT) : [];
    const measuredStart = windowed[0]?.t ?? 0;
    const measuredEnd = windowed[windowed.length - 1]?.t ?? 0;
    const livePoints = input.bbpActive
        ? livePointsFromBbp(windowed, measuredEnd)
        : shiftLivePoints(input.livePoints, savedExtent.span);
    const savedLeft = combined.bbpRange?.start ?? 0;
    const measuredLeft = windowed.length === 0 ? savedLeft : measuredStart - measuredEnd;
    const left = Math.min(savedLeft, measuredLeft, 0);
    let bbpRange = combined.bbpRange;
    if (input.bbpActive) bbpRange = measuredEnd > 0 ? { start: left, end: 0 } : undefined;

    return {
        livePoints,
        targetPoints: combined.points,
        xMin: left,
        xMaxFloor: undefined,
        bbpRange,
    };
};
