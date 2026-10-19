import { toDisplayRoR } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '../../model/settings';

export const ROR_AXIS_MAX_TICKS = 80;

export const alignRorAxisBound = (value: number, interval: number, edge: 'min' | 'max'): number => {
    if (!Number.isFinite(value) || !Number.isFinite(interval) || interval <= 0) return value;
    const factor = value / interval;
    const aligned = edge === 'min' ? Math.floor(factor) : Math.ceil(factor);
    return aligned * interval;
};

/** Smallest integer display step so `(max − min) / interval ≤ maxTicks` (see #798). */
export const capRorDisplayInterval = (
    span: number,
    requestedDisplayInterval: number,
    maxTicks = ROR_AXIS_MAX_TICKS,
): { interval: number; capped: boolean } => {
    if (
        !Number.isFinite(span) ||
        span <= 0 ||
        !Number.isFinite(requestedDisplayInterval) ||
        requestedDisplayInterval <= 0
    ) {
        return { interval: requestedDisplayInterval, capped: false };
    }
    if (span / requestedDisplayInterval <= maxTicks) {
        return { interval: requestedDisplayInterval, capped: false };
    }
    const interval = Math.max(1, Math.ceil(span / maxTicks));
    return { interval, capped: true };
};

export const resolveRorAxisInterval = (
    minDisplay: number,
    maxDisplay: number,
    storedIntervalC: number,
    unit: TemperatureUnit,
): { displayInterval: number; capped: boolean; requestedDisplayInterval: number } => {
    const requestedDisplayInterval = toDisplayRoR(storedIntervalC, unit);
    const { interval, capped } = capRorDisplayInterval(maxDisplay - minDisplay, requestedDisplayInterval);
    return { displayInterval: interval, capped, requestedDisplayInterval };
};

export const countRorTicks = (minDisplay: number, maxDisplay: number, displayInterval: number): number => {
    if (displayInterval <= 0 || maxDisplay < minDisplay) return 0;
    const alignedMin = alignRorAxisBound(minDisplay, displayInterval, 'min');
    const alignedMax = alignRorAxisBound(maxDisplay, displayInterval, 'max');
    return Math.floor((alignedMax - alignedMin) / displayInterval) + 1;
};
