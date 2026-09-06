import type { LiveRoastPoint } from '@features/active-roast';
import { CHART_GRID_RIGHT, CHART_GRID_RIGHT_WITH_ROR } from '@features/active-roast/lib/chart-config';
import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { useChartZoom } from '@features/active-roast/model/useChartZoom';
import type { TsvPoint } from '@shared/lib/tsv';
import { useMemo } from 'react';
import { buildLiveChartData, CHART_TOTAL_SECS, type LiveChartRow } from '../lib/chart-pipeline-data';

export interface UseChartPipelineParams {
    livePoints: LiveRoastPoint[];
    targetCurvePoints: TsvPoint[];
    preChargeDisplaySec: number;
    showRoR: boolean;
    showControlChart: boolean;
    unit: TemperatureUnit;
}

export interface UseChartPipelineReturn {
    chartData: LiveChartRow[];
    targetSeries: { time: number; bt: number }[];
    visibleChartData: LiveChartRow[];
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
    handleChartPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    handleChartPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    endChartDrag: (event: React.PointerEvent<HTMLDivElement>) => void;
    setZoomRange: (range: { start: number; end: number } | null) => void;
    setHoveredChartIndex: (index: number | null) => void;
}

export const useChartPipeline = (params: UseChartPipelineParams): UseChartPipelineReturn => {
    const { livePoints, targetCurvePoints, preChargeDisplaySec, showRoR, showControlChart, unit } = params;

    const { chartData, targetSeries } = useMemo(() => {
        const profileDuration = targetCurvePoints.length > 0 ? targetCurvePoints[targetCurvePoints.length - 1].t : 0;
        return {
            chartData: buildLiveChartData(livePoints, preChargeDisplaySec, profileDuration),
            targetSeries: targetCurvePoints.map((p) => ({ time: p.t, bt: p.bt })),
        };
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
        handleChartPointerDown,
        handleChartPointerMove,
        endChartDrag,
    } = useChartZoom(maxTime, minTime, chartRightGridPad);

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
        handleChartPointerDown,
        handleChartPointerMove,
        endChartDrag,
        setZoomRange,
        setHoveredChartIndex,
    };
};
