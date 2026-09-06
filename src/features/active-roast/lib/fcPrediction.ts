import { parseStoredRoastEvents } from './serialize-roast-events';

/** Fallback when no recent-session median and no reference FC BT exist. */
export const DEFAULT_FC_TARGET_C = 196;
export const FC_PREDICTION_EMA_ALPHA = 0.3;
/** Show even without Yellow once BT is this close to the FC target. */
export const FC_PREDICTION_BT_WINDOW_C = 40;
const ROR_MIN_C_PER_MIN = 0.5;

/**
 * Linear FC ETA (seconds since charge) from current BT + RoR.
 * Returns null while RoR is stalled/falling or BT has already reached the target.
 */
export const predictFcTime = (elapsedS: number, bt: number, rorPerMin: number, fcTargetC: number): number | null => {
    if (rorPerMin <= ROR_MIN_C_PER_MIN || bt >= fcTargetC) return null;
    return elapsedS + ((fcTargetC - bt) / rorPerMin) * 60;
};

export const median = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** FC Start BT from a stored events payload (jsonb or already-parsed). */
export const extractFcStartBt = (events: unknown): number | null => {
    const fc = parseStoredRoastEvents(events).find((e) => e.type === 'FC Start');
    const t = fc?.temp_c;
    return t != null && Number.isFinite(t) ? t : null;
};

/** Same-bean recent median → reference FC BT → 196°C. */
export const resolveFcTargetC = (recentFcBts: number[], referenceFcBt: number | null): number => {
    const med = median(recentFcBts);
    if (med != null) return med;
    if (referenceFcBt != null && Number.isFinite(referenceFcBt)) return referenceFcBt;
    return DEFAULT_FC_TARGET_C;
};

export const shouldShowFcPrediction = (opts: {
    hasYellow: boolean;
    hasFcStart: boolean;
    hasDrop: boolean;
    bt: number | null;
    fcTargetC: number;
    charged: boolean;
    roastEnded: boolean;
}): boolean => {
    if (!opts.charged || opts.roastEnded || opts.hasFcStart || opts.hasDrop || opts.bt == null) return false;
    return opts.hasYellow || opts.bt > opts.fcTargetC - FC_PREDICTION_BT_WINDOW_C;
};

/** EMA; null next clears so a new roast does not inherit the previous curve. */
export const smoothFcPrediction = (
    prev: number | null,
    next: number | null,
    alpha = FC_PREDICTION_EMA_ALPHA,
): number | null => {
    if (next == null) return null;
    if (prev == null) return next;
    return prev + alpha * (next - prev);
};
