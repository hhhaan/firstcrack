import { CHART_GRID_RIGHT, CHART_GRID_RIGHT_WITH_ROR } from '@features/active-roast/lib/chart-config';
import {
    type ReferenceCurvePoint,
    referenceCurveFromPoints,
    referenceCurveInRange,
    toDisplayReferenceCurve,
} from '@features/active-roast/lib/reference-curve';
import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { useChartZoom } from '@features/active-roast/model/useChartZoom';
import { feedbackValue } from '@shared/lib/feedback';
import type { TsvPoint } from '@shared/lib/tsv';
import type { ReadUnits } from '@shared/types/sidecar';
import { useMemo } from 'react';
import { buildLiveChartData, CHART_TOTAL_SECS, type LiveChartRow } from '../lib/chart-pipeline-data';
import type { LiveRoastPoint } from './useSidecarPolling';

export interface UseChartPipelineParams {
    livePoints: LiveRoastPoint[];
    targetCurvePoints: TsvPoint[];
    xMin: number;
    xMaxFloor?: number;
    autoExpandTimeAxis?: boolean;
    showRoR: boolean;
    showControlChart: boolean;
    unit: TemperatureUnit;
}

export interface UseChartPipelineReturn {
    chartData: LiveChartRow[];
    targetSeries: ReferenceCurvePoint[];
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
    visibleTargetEt: (number | null)[];
    visibleTargetRor: (number | null)[];
    visibleTargetEtRor: (number | null)[];
    visibleTargetHeater: (number | null)[];
    visibleTargetFan: (number | null)[];
    visibleTargetDrum: (number | null)[];
    visibleControlXs: number[];
    visibleReadUnits: (ReadUnits | undefined)[];
    visibleTargetReadUnits: (ReadUnits | undefined)[];
    visibleDrumTemp: (number | null)[];
    visibleHeatPower: (number | null)[];
    visibleFanSpeed: (number | null)[];
    visibleHeatSet: (number | null)[];
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
    const {
        livePoints,
        targetCurvePoints,
        xMin,
        xMaxFloor = CHART_TOTAL_SECS,
        autoExpandTimeAxis = true,
        showRoR,
        showControlChart,
        unit,
    } = params;

    const { chartData, targetSeries } = useMemo(() => {
        const profileDuration = targetCurvePoints.length > 0 ? targetCurvePoints[targetCurvePoints.length - 1].t : 0;
        return {
            chartData: buildLiveChartData(livePoints, xMin, profileDuration, xMaxFloor, autoExpandTimeAxis),
            targetSeries: referenceCurveFromPoints(targetCurvePoints),
        };
    }, [livePoints, targetCurvePoints, xMin, xMaxFloor, autoExpandTimeAxis]);

    const maxTime = chartData.length > 0 ? chartData[chartData.length - 1].time : xMaxFloor;
    const minTime = xMin;
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

    const visibleReference = useMemo(
        () =>
            toDisplayReferenceCurve(
                referenceCurveInRange(
                    targetSeries,
                    effectiveZoomRange ?? (autoExpandTimeAxis ? null : { start: xMin, end: xMaxFloor }),
                ),
                unit,
            ),
        [targetSeries, effectiveZoomRange, unit, autoExpandTimeAxis, xMin, xMaxFloor],
    );

    const { visibleControlXs, visibleDrumTemp, visibleHeatPower, visibleFanSpeed, visibleHeatSet, visibleReadUnits } =
        useMemo(() => {
            const points = effectiveZoomRange
                ? livePoints.filter((p) => p.time >= effectiveZoomRange.start && p.time <= effectiveZoomRange.end)
                : livePoints;
            return {
                visibleReadUnits: points.map((p) => p.processing?.read_units),
                visibleControlXs: points.map((p) => p.time),
                visibleDrumTemp: points.map((p) => feedbackValue(p.drum, 'drum', p.processing?.read_units)),
                visibleHeatPower: points.map((p) => feedbackValue(p.heater, 'heater', p.processing?.read_units)),
                visibleFanSpeed: points.map((p) => feedbackValue(p.fan, 'fan', p.processing?.read_units)),
                visibleHeatSet: points.map((p) => p.heaterSet ?? null),
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
        visibleReadUnits,
        visibleTargetReadUnits: visibleReference.readUnits,
        visibleTargetXs: visibleReference.xs,
        visibleTargetBt: visibleReference.bt,
        visibleTargetEt: visibleReference.et,
        visibleTargetRor: visibleReference.ror,
        visibleTargetEtRor: visibleReference.rorEt,
        visibleTargetHeater: visibleReference.heater,
        visibleTargetFan: visibleReference.fan,
        visibleTargetDrum: visibleReference.drum,
        visibleControlXs,
        visibleDrumTemp,
        visibleHeatPower,
        visibleFanSpeed,
        visibleHeatSet,
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
