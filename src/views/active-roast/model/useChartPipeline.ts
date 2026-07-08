import { CHART_GRID_RIGHT, CHART_GRID_RIGHT_WITH_ROR } from '@features/active-roast/lib/chart-config';
import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { interpolateProfileBT } from '@shared/data/roast-profiles';
import type { TsvPoint } from '@shared/lib/tsv';
import { useEffect, useMemo } from 'react';
import { useChartZoom } from './useChartZoom';
import type { LiveRoastPoint } from './useSidecarPolling';

const CHART_TOTAL_SECS = 780;

export interface UseChartPipelineParams {
    livePoints: LiveRoastPoint[];
    targetCurvePoints: TsvPoint[];
    preChargeDisplaySec: number;
    showRoR: boolean;
    showControlChart: boolean;
    unit: TemperatureUnit;
    isFullscreen: boolean;
}

export interface UseChartPipelineReturn {
    chartData: {
        time: number;
        btActual: number | null;
        etActual: number | null;
        rorActual: number | null;
        etRorActual: number | null;
        btTarget: number | null;
    }[];
    targetSeries: { time: number; bt: number }[];
    visibleChartData: {
        time: number;
        btActual: number | null;
        etActual: number | null;
        rorActual: number | null;
        etRorActual: number | null;
        btTarget: number | null;
    }[];
    chartAreaRef: React.RefObject<HTMLDivElement | null>;
    mainChartHeight: number;
    effectiveZoomRange: { start: number; end: number } | null;
    isChartDragging: boolean;
    visibleXs: number[];
    visibleBtActual: (number | null)[];
    visibleEtActual: (number | null)[];
    visibleRorActual: (number | null)[];
    visibleRorEtActual: (number | null)[];
    visibleTargetXs: number[];
    visibleTargetBt: number[];
    visibleControlXs: number[];
    visibleDrumTemp: (number | null)[];
    visibleHeatPower: (number | null)[];
    visibleFanSpeed: (number | null)[];
    maxTime: number;
    minTime: number;
    hoveredChartIndexRef: React.RefObject<number | null>;
    handleChartWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
    handleChartPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    handleChartPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    endChartDrag: (event: React.PointerEvent<HTMLDivElement>) => void;
    setZoomRange: (range: { start: number; end: number } | null) => void;
    setHoveredChartIndex: (index: number | null) => void;
}

export const useChartPipeline = (params: UseChartPipelineParams): UseChartPipelineReturn => {
    const { livePoints, targetCurvePoints, preChargeDisplaySec, showRoR, showControlChart, unit, isFullscreen } =
        params;

    const { chartData, targetSeries } = useMemo(() => {
        const hasTarget = targetCurvePoints.length > 0;
        const sentinel = (t: number) => ({
            time: t,
            btActual: null as number | null,
            etActual: null as number | null,
            rorActual: null as number | null,
            etRorActual: null as number | null,
            btTarget: hasTarget ? interpolateProfileBT(targetCurvePoints, t) : null,
        });

        const live = livePoints.map((p) => ({
            time: p.time,
            btActual: p.bt,
            etActual: p.et,
            rorActual: p.ror,
            etRorActual: p.ror_et,
            btTarget: hasTarget ? interpolateProfileBT(targetCurvePoints, p.time) : null,
        }));

        const seen = new Set<number>();
        const deduped: ReturnType<typeof sentinel>[] = [];
        for (const p of live) {
            const key = Math.round(p.time * 100);
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(p);
            }
        }
        deduped.sort((a, b) => a.time - b.time);

        const xMin = -preChargeDisplaySec;
        const profileDuration = targetCurvePoints.length > 0 ? targetCurvePoints[targetCurvePoints.length - 1].t : 0;
        const liveMax = livePoints.length > 0 ? livePoints[livePoints.length - 1].time : 0;
        const chartTotalSecs = Math.max(CHART_TOTAL_SECS, profileDuration, liveMax);
        const needsStart = deduped.length === 0 || deduped[0].time > xMin + 0.5;
        const needsEnd = deduped.length === 0 || deduped[deduped.length - 1].time < chartTotalSecs - 1;
        const chart = [
            ...(needsStart ? [sentinel(xMin)] : []),
            ...deduped,
            ...(needsEnd ? [sentinel(chartTotalSecs)] : []),
        ];

        const targetSeries = targetCurvePoints.map((p) => ({
            time: p.t,
            bt: p.bt,
        }));

        return { chartData: chart, targetSeries };
    }, [livePoints, targetCurvePoints, preChargeDisplaySec]);

    const maxTime = chartData.length > 0 ? chartData[chartData.length - 1].time : CHART_TOTAL_SECS;
    const minTime = -preChargeDisplaySec;
    const chartRightGridPad = showRoR || showControlChart ? CHART_GRID_RIGHT_WITH_ROR : CHART_GRID_RIGHT;

    const {
        setZoomRange,
        effectiveZoomRange,
        hoveredChartIndexRef,
        setHoveredChartIndex,
        isChartDragging,
        mainChartHeight,
        chartAreaRef,
        handleChartWheel,
        handleChartPointerDown,
        handleChartPointerMove,
        endChartDrag,
    } = useChartZoom(maxTime, minTime, chartRightGridPad);

    useEffect(() => {
        if (isFullscreen) setZoomRange(null);
    }, [isFullscreen, setZoomRange]);

    const visibleChartData = useMemo(
        () =>
            effectiveZoomRange
                ? chartData.filter((p) => p.time >= effectiveZoomRange.start && p.time <= effectiveZoomRange.end)
                : chartData,
        [chartData, effectiveZoomRange],
    );

    const { visibleXs, visibleBtActual, visibleEtActual, visibleRorActual, visibleRorEtActual } = useMemo(() => {
        const xs: number[] = [];
        const btActual: (number | null)[] = [];
        const etActual: (number | null)[] = [];
        const rorActual: (number | null)[] = [];
        const rorEtActual: (number | null)[] = [];
        for (const p of visibleChartData) {
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
    }, [visibleChartData, unit]);

    const { visibleTargetXs, visibleTargetBt } = useMemo(() => {
        const points = effectiveZoomRange
            ? targetSeries.filter((p) => p.time >= effectiveZoomRange.start && p.time <= effectiveZoomRange.end)
            : targetSeries;
        return {
            visibleTargetXs: points.map((p) => p.time),
            visibleTargetBt: points.map((p) => toDisplayTemp(p.bt, unit)),
        };
    }, [targetSeries, effectiveZoomRange, unit]);

    const { visibleControlXs, visibleDrumTemp, visibleHeatPower, visibleFanSpeed } = useMemo(() => {
        const points = effectiveZoomRange
            ? livePoints.filter((p) => p.time >= effectiveZoomRange.start && p.time <= effectiveZoomRange.end)
            : livePoints;
        return {
            visibleControlXs: points.map((p) => p.time),
            visibleDrumTemp: points.map((p) => p.drum),
            visibleHeatPower: points.map((p) => p.heater),
            visibleFanSpeed: points.map((p) => p.fan),
        };
    }, [livePoints, effectiveZoomRange]);

    return {
        chartData,
        targetSeries,
        visibleChartData,
        chartAreaRef,
        mainChartHeight,
        effectiveZoomRange,
        isChartDragging,
        visibleXs,
        visibleBtActual,
        visibleEtActual,
        visibleRorActual,
        visibleRorEtActual,
        visibleTargetXs,
        visibleTargetBt,
        visibleControlXs,
        visibleDrumTemp,
        visibleHeatPower,
        visibleFanSpeed,
        maxTime,
        minTime,
        hoveredChartIndexRef,
        handleChartWheel,
        handleChartPointerDown,
        handleChartPointerMove,
        endChartDrag,
        setZoomRange,
        setHoveredChartIndex,
    };
};
