import { interpolateProfileBT } from '@shared/data/roast-profiles';

const SAMPLE_INTERVAL_SEC = 30;
const Y_PADDING_C = 8;
const Y_STEP_C = 5;
const DEFAULT_Y_RANGE: [number, number] = [140, 230];

export const computeProfileCurveYRange = (curves: { t: number; bt: number }[][]): [number, number] => {
    const bts = curves.flatMap((curve) => curve.map((p) => p.bt)).filter((n) => Number.isFinite(n));
    if (bts.length === 0) return DEFAULT_Y_RANGE;

    const rawMin = Math.min(...bts);
    const rawMax = Math.max(...bts);
    let min = Math.floor((rawMin - Y_PADDING_C) / Y_STEP_C) * Y_STEP_C;
    let max = Math.ceil((rawMax + Y_PADDING_C) / Y_STEP_C) * Y_STEP_C;

    if (max - min < 30) {
        const mid = (rawMin + rawMax) / 2;
        min = Math.floor((mid - 15) / Y_STEP_C) * Y_STEP_C;
        max = Math.ceil((mid + 15) / Y_STEP_C) * Y_STEP_C;
    }

    return [min, max];
};

export const buildProfileCurvePlotData = (curves: { t: number; bt: number }[][]) => {
    const maxT = Math.max(...curves.map((curve) => curve[curve.length - 1]?.t ?? 0));
    const xs: number[] = [];
    for (let t = 0; t <= maxT; t += SAMPLE_INTERVAL_SEC) xs.push(t);

    const ysArrays = curves.map((curve) => xs.map((t) => interpolateProfileBT(curve, t)));

    return { xs, ysArrays, yRange: computeProfileCurveYRange(curves) };
};
