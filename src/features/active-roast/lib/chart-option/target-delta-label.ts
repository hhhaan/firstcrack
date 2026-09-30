import { scaleChartPx } from '@features/active-roast/lib/chart-config';
import { interpolateProfileBT } from '@shared/data/roast-profiles';
import type { TemperatureUnit } from '../../model/settings';

/** Same ±2°C band as side-panel calcTargetDelta */
const TARGET_DELTA_BAND_C = 2;

const nearestDisplayAt = (xs: number[], values: (number | null)[], timeSec: number): number | null => {
    if (!xs.length) return null;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < xs.length; i++) {
        if (values[i] === null || values[i] === undefined) continue;
        const d = Math.abs(xs[i] - timeSec);
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }
    return bestIdx >= 0 ? values[bestIdx] : null;
};

export type TargetDeltaLabelStatus = 'within' | 'over' | 'under';

export interface TargetDeltaLabelColors {
    within: string;
    over: string;
    under: string;
}

export interface BuildTargetDeltaMarkPointParams {
    show: boolean;
    charged: boolean;
    currentTimeSec: number;
    xs: number[];
    /** Display-unit BT series (already °C/°F converted) */
    btActual: (number | null)[];
    targetXs?: number[];
    targetBt?: (number | null)[];
    temperatureUnit: TemperatureUnit;
    colors: TargetDeltaLabelColors;
    fontScale?: number;
}

/** Format signed delta like side panel: +2.3° / −1.0° */
export const formatTargetDeltaLabel = (deltaDisplay: number): string => {
    const sign = deltaDisplay >= 0 ? '+' : '−';
    return `${sign}${Math.abs(deltaDisplay).toFixed(1)}°`;
};

export const classifyTargetDelta = (deltaDisplay: number, unit: TemperatureUnit): TargetDeltaLabelStatus => {
    const deltaC = unit === 'F' ? (deltaDisplay * 5) / 9 : deltaDisplay;
    if (Math.abs(deltaC) <= TARGET_DELTA_BAND_C) return 'within';
    return deltaC > 0 ? 'over' : 'under';
};

/**
 * ECharts markPoint at mid(BT, target) for current time.
 * Inputs are display-unit series (same as chart). Returns null if unavailable.
 */
export const buildTargetDeltaMarkPoint = (params: BuildTargetDeltaMarkPointParams): object | null => {
    const {
        show,
        charged,
        currentTimeSec,
        xs,
        btActual,
        targetXs,
        targetBt,
        temperatureUnit,
        colors,
        fontScale = 1,
    } = params;
    if (!show || !charged || !targetXs?.length || !targetBt?.length) return null;
    if (!Number.isFinite(currentTimeSec)) return null;

    const bt = nearestDisplayAt(xs, btActual, currentTimeSec);
    if (bt == null) return null;

    const targetCurve = targetXs
        .map((t, i) => {
            const v = targetBt[i];
            return v == null ? null : { t, bt: v };
        })
        .filter((p): p is { t: number; bt: number } => p != null);
    if (targetCurve.length === 0) return null;

    const firstTargetTime = targetCurve[0]?.t;
    const lastTargetTime = targetCurve[targetCurve.length - 1]?.t;
    if (
        firstTargetTime === undefined ||
        lastTargetTime === undefined ||
        currentTimeSec < firstTargetTime ||
        currentTimeSec > lastTargetTime
    ) {
        return null;
    }

    const targetVal = interpolateProfileBT(targetCurve, currentTimeSec);
    if (targetVal === null) return null;

    const deltaDisplay = bt - targetVal;
    const status = classifyTargetDelta(deltaDisplay, temperatureUnit);
    const midY = (bt + targetVal) / 2;

    return {
        name: 'ΔTarget',
        coord: [currentTimeSec, midY] as [number, number],
        symbol: 'none' as const,
        label: {
            show: true,
            position: 'right' as const,
            distance: 6,
            formatter: formatTargetDeltaLabel(deltaDisplay),
            fontSize: scaleChartPx(11, fontScale),
            fontWeight: 700 as const,
            fontFamily: 'monospace',
            color: colors[status],
            backgroundColor: 'transparent',
            borderWidth: 0,
            padding: 0,
        },
    };
};
