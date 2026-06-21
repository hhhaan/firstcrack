import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import type { LiveRoastPoint } from '../model/useSidecarPolling';

export interface ChartSeriesData {
    visibleXs: number[];
    visibleBtActual: (number | null)[];
    visibleEtActual: (number | null)[];
    visibleRorActual: (number | null)[];
    visibleRorEtActual: (number | null)[];
}

/**
 * visibleChartData → 표시 온도 시리즈로 변환
 */
export const extractVisibleSeries = (
    chartData: {
        time: number;
        btActual: number | null;
        etActual: number | null;
        rorActual: number | null;
        etRorActual: number | null;
    }[],
    unit: TemperatureUnit,
): ChartSeriesData => {
    const xs: number[] = [];
    const btActual: (number | null)[] = [];
    const etActual: (number | null)[] = [];
    const rorActual: (number | null)[] = [];
    const rorEtActual: (number | null)[] = [];
    for (const p of chartData) {
        xs.push(p.time);
        btActual.push(p.btActual != null ? toDisplayTemp(p.btActual, unit) : null);
        etActual.push(p.etActual != null ? toDisplayTemp(p.etActual, unit) : null);
        rorActual.push(p.rorActual != null ? toDisplayRoR(p.rorActual, unit) : null);
        rorEtActual.push(p.etRorActual != null ? toDisplayRoR(p.etRorActual, unit) : null);
    }
    return {
        visibleXs: xs,
        visibleBtActual: btActual,
        visibleEtActual: etActual,
        visibleRorActual: rorActual,
        visibleRorEtActual: rorEtActual,
    };
};

export interface TargetSeriesData {
    visibleTargetXs: number[];
    visibleTargetBt: number[];
}

/**
 * targetSeries → 표시 타깃 시리즈로 변환
 */
export const extractVisibleTarget = (
    targetSeries: { time: number; bt: number }[],
    unit: TemperatureUnit,
): TargetSeriesData => ({
    visibleTargetXs: targetSeries.map((p) => p.time),
    visibleTargetBt: targetSeries.map((p) => toDisplayTemp(p.bt, unit)),
});

export interface ControlSeriesData {
    visibleControlXs: number[];
    visibleDrumTemp: (number | null)[];
    visibleHeatPower: (number | null)[];
    visibleFanSpeed: (number | null)[];
}

/**
 * livePoints → 표시 제어 시리즈로 변환
 */
export const extractVisibleControl = (livePoints: LiveRoastPoint[]): ControlSeriesData => ({
    visibleControlXs: livePoints.map((p) => p.time),
    visibleDrumTemp: livePoints.map((p) => p.drum as number | null),
    visibleHeatPower: livePoints.map((p) => p.heater as number | null),
    visibleFanSpeed: livePoints.map((p) => p.fan as number | null),
});
