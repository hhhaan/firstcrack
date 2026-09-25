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

/** BBP and roast use separate timelines, each starting at 0. */
export const resolveLiveChartView = (input: {
    bbpActive: boolean;
    charged: boolean;
    livePoints: LiveRoastPoint[];
    bbpPoints: BbpPoint[];
    roastTarget: TsvPoint[];
    bbpTarget: TsvPoint[];
    bbpTargetError: boolean;
    bbpWindowSeconds?: number;
}): LiveChartView => {
    if (input.charged || !input.bbpActive) {
        return {
            livePoints: input.livePoints,
            targetPoints: input.roastTarget,
            xMin: 0,
            xMaxFloor: undefined,
        };
    }

    const windowSeconds = input.bbpWindowSeconds ?? BBP_MAX_SECONDS;
    const source = input.bbpTargetError ? [] : input.bbpTarget;
    const latestSavedT = sampleExtent(source).max;
    const saved = source.filter((p) => p.t >= latestSavedT - windowSeconds);
    const savedExtent = sampleExtent(saved);
    const targetPoints = saved.map((p) => ({ ...p, t: p.t - savedExtent.min }));
    const lastT = input.bbpPoints[input.bbpPoints.length - 1]?.t ?? 0;
    const windowed = rebaseBbpWindow(input.bbpPoints, lastT, windowSeconds);
    const measuredStart = windowed[0]?.t ?? 0;
    const measuredEnd = (windowed[windowed.length - 1]?.t ?? measuredStart) - measuredStart;

    return {
        livePoints: livePointsFromBbp(windowed.map((p) => ({ ...p, t: p.t - measuredStart }))),
        targetPoints,
        xMin: 0,
        xMaxFloor: Math.max(60, Math.ceil(measuredEnd / 60) * 60 + 60),
        bbpRange: measuredEnd > 0 ? { start: 0, end: measuredEnd } : undefined,
    };
};
