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

/**
 * 20min is the FIFO cap (#536), not a slot that must be drawn.
 * A saved curve whose shift is that cap but whose samples cover less is
 * re-anchored so the last sample sits on Charge and the empty lead/tail goes away.
 */
const trimCapSlot = (
    points: TsvPoint[],
    range: { start: number; end: number } | undefined,
    source: TsvPoint[],
): { points: TsvPoint[]; range?: { start: number; end: number }; shift: number } => {
    const shift = range ? -range.start : 0;
    if (!range || shift < BBP_MAX_SECONDS - 1 || source.length === 0) return { points, range, shift };
    const { min, max, span } = sampleExtent(source);
    if (span >= BBP_MAX_SECONDS - 1 || max <= 0) return { points, range, shift };
    const before: TsvPoint[] = [];
    for (const p of source) {
        const t = p.t - max;
        if (t < 0) before.push({ ...p, t, ror: null });
    }
    const roast: TsvPoint[] = [];
    for (const p of points) {
        if (p.t >= 0) roast.push(p);
    }
    return { points: [...before, ...roast], range: { start: min - max, end: 0 }, shift: max };
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

    const source = input.bbpTargetError ? [] : input.bbpTarget;
    const combined = combineBbpCurve(input.roastTarget, source, input.bbpSeconds);
    const trimmed = trimCapSlot(combined.points, combined.bbpRange, source);
    const lastT = input.bbpPoints[input.bbpPoints.length - 1]?.t ?? 0;
    const windowed = input.bbpActive ? rebaseBbpWindow(input.bbpPoints, lastT) : [];
    const measuredStart = windowed[0]?.t ?? 0;
    const measuredEnd = windowed[windowed.length - 1]?.t ?? 0;
    // Rebased window end sits on the cap even when the first kept sample is later.
    const atCap = measuredEnd >= BBP_MAX_SECONDS - 1;
    const duration = trimmed.shift > 0 ? trimmed.shift : measuredEnd;
    const livePoints = input.bbpActive
        ? livePointsFromBbp(windowed, duration)
        : shiftLivePoints(input.livePoints, duration);
    const savedLeft = trimmed.range?.start ?? 0;
    const measuredLeft = windowed.length === 0 ? savedLeft : atCap ? measuredStart - duration : -duration;
    const left = Math.min(savedLeft, measuredLeft, 0);
    const bbpRange = input.bbpActive
        ? measuredEnd > 0
            ? { start: Math.min(savedLeft, measuredLeft), end: measuredEnd - duration }
            : undefined
        : trimmed.range;

    return {
        livePoints,
        targetPoints: trimmed.points,
        xMin: left,
        xMaxFloor: undefined,
        bbpRange,
    };
};
