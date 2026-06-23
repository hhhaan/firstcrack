import { CHART_GRID_RIGHT, CHART_GRID_RIGHT_WITH_ROR } from '@features/active-roast/lib/chart-config';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import type { TsvPoint } from '@shared/lib/tsv';
import { useEffect, useMemo } from 'react';
import { extractVisibleControl, extractVisibleSeries, extractVisibleTarget } from '../lib/chart-series';
import { CHART_TOTAL_SECS, useChartData } from './useChartData';
import { useChartZoom } from './useChartZoom';
import type { LiveRoastPoint } from './useSidecarPolling';

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
    chartData: ReturnType<typeof useChartData>['chartData'];
    targetSeries: ReturnType<typeof useChartData>['targetSeries'];
    visibleChartData: ReturnType<typeof useChartData>['chartData'];
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

    const { chartData, targetSeries } = useChartData({
        livePoints,
        targetCurvePoints,
        preChargeDisplaySec,
    });

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

    const { visibleXs, visibleBtActual, visibleEtActual, visibleRorActual, visibleRorEtActual } = useMemo(
        () => extractVisibleSeries(visibleChartData, unit),
        [visibleChartData, unit],
    );

    const { visibleTargetXs, visibleTargetBt } = useMemo(() => {
        const points = effectiveZoomRange
            ? targetSeries.filter((p) => p.time >= effectiveZoomRange.start && p.time <= effectiveZoomRange.end)
            : targetSeries;
        return extractVisibleTarget(points, unit);
    }, [targetSeries, effectiveZoomRange, unit]);

    const { visibleControlXs, visibleDrumTemp, visibleHeatPower, visibleFanSpeed } = useMemo(() => {
        const points = effectiveZoomRange
            ? livePoints.filter((p) => p.time >= effectiveZoomRange.start && p.time <= effectiveZoomRange.end)
            : livePoints;
        return extractVisibleControl(points);
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
