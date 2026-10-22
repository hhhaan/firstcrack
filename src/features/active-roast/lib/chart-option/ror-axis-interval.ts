import { toDisplayRoR } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '../../model/settings';

export const ROR_AXIS_MAX_TICKS = 80;

const alignEpsilon = (factor: number): number => Math.max(1e-9, Math.abs(factor) * 1e-9);

export const alignRorAxisBound = (value: number, interval: number, edge: 'min' | 'max'): number => {
    if (!Number.isFinite(value) || !Number.isFinite(interval) || interval <= 0) return value;
    const factor = value / interval;
    const eps = alignEpsilon(factor);
    const aligned = edge === 'min' ? Math.floor(factor + eps) : Math.ceil(factor - eps);
    return aligned * interval;
};

const maxRorTickPositions = (maxTicks = ROR_AXIS_MAX_TICKS): number => maxTicks + 1;

/** Raise display step until snapped tick count fits the cap (see #798). */
export const capRorDisplayInterval = (
    minDisplay: number,
    maxDisplay: number,
    requestedDisplayInterval: number,
    maxTicks = ROR_AXIS_MAX_TICKS,
): { interval: number; capped: boolean } => {
    if (
        !Number.isFinite(minDisplay) ||
        !Number.isFinite(maxDisplay) ||
        maxDisplay < minDisplay ||
        !Number.isFinite(requestedDisplayInterval) ||
        requestedDisplayInterval <= 0
    ) {
        return { interval: requestedDisplayInterval, capped: false };
    }
    const tickLimit = maxRorTickPositions(maxTicks);
    if (countRorTicks(minDisplay, maxDisplay, requestedDisplayInterval) <= tickLimit) {
        return { interval: requestedDisplayInterval, capped: false };
    }
    let interval = Math.max(1, Math.ceil(requestedDisplayInterval));
    while (countRorTicks(minDisplay, maxDisplay, interval) > tickLimit) {
        interval += 1;
    }
    return { interval, capped: true };
};

export const resolveRorAxisInterval = (
    minDisplay: number,
    maxDisplay: number,
    storedIntervalC: number,
    unit: TemperatureUnit,
): { displayInterval: number; capped: boolean; requestedDisplayInterval: number } => {
    const requestedDisplayInterval = toDisplayRoR(storedIntervalC, unit);
    const { interval, capped } = capRorDisplayInterval(minDisplay, maxDisplay, requestedDisplayInterval);
    return { displayInterval: interval, capped, requestedDisplayInterval };
};

export const countRorTicks = (minDisplay: number, maxDisplay: number, displayInterval: number): number => {
    if (displayInterval <= 0 || maxDisplay < minDisplay) return 0;
    const alignedMin = alignRorAxisBound(minDisplay, displayInterval, 'min');
    const alignedMax = alignRorAxisBound(maxDisplay, displayInterval, 'max');
    const span = alignedMax - alignedMin;
    const steps = span / displayInterval;
    const eps = alignEpsilon(steps);
    return Math.floor(steps + eps) + 1;
};
