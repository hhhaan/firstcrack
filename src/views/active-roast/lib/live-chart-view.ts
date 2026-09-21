import { type BbpPoint, rebaseBbpWindow } from '@features/active-roast/model/bbp';
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

/** Charge 전: 타깃 점선(BBP+로스팅) + 현재 온도. Charge 후: 00:00 로스팅만 (#433). */
export const resolveLiveChartView = (input: {
    bbpActive: boolean;
    charged: boolean;
    livePoints: LiveRoastPoint[];
    bbpPoints: BbpPoint[];
    roastTarget: TsvPoint[];
    bbpTarget: TsvPoint[];
    bbpTargetError: boolean;
    bbpSeconds?: number | null;
}): LiveChartView => {
    if (!(input.bbpActive || !input.charged)) {
        return {
            livePoints: input.livePoints,
            targetPoints: input.roastTarget,
            xMin: 0,
            xMaxFloor: undefined,
        };
    }

    const combined = combineBbpCurve(input.roastTarget, input.bbpTargetError ? [] : input.bbpTarget, input.bbpSeconds);
    const lastT = input.bbpPoints[input.bbpPoints.length - 1]?.t ?? 0;
    const windowed = input.bbpActive ? rebaseBbpWindow(input.bbpPoints, lastT) : [];
    const elapsed = input.bbpActive ? (windowed[windowed.length - 1]?.t ?? 0) : 0;
    const duration = combined.bbpRange ? -combined.bbpRange.start : elapsed;
    const livePoints = input.bbpActive
        ? livePointsFromBbp(windowed, duration)
        : shiftLivePoints(input.livePoints, duration);
    const liveMin = livePoints[0]?.time ?? 0;
    const bbpRange = input.bbpActive
        ? elapsed > 0
            ? { start: -duration, end: elapsed - duration }
            : undefined
        : combined.bbpRange;

    return {
        livePoints,
        targetPoints: combined.points,
        xMin: Math.min(-duration, liveMin, 0),
        xMaxFloor: undefined,
        bbpRange,
    };
};
