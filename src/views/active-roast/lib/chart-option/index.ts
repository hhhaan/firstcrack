import type { EChartsOption } from 'echarts';
import {
    buildAxisStyles,
    buildCrossLineStyle,
    buildDualGridLayout,
    buildSingleGridLayout,
    buildTooltipCrossPointer,
    buildXAxisPointer,
    buildYAxisPointer,
    computeGridMargins,
    computeTempYRange,
} from './axes';
import { buildMarkers } from './markers';
import { buildControlSeries, buildPhaseSeries, buildTempSeries } from './series';
import { createAxisTooltipFormatter } from './tooltip';
import type { ChartOptionParams } from './types';

export { fmtSec } from './axes';
export type { ChartOptionParams, ControlData, ResolvedChartColors, RoastEventMarker } from './types';

export const buildRoastChartOption = (params: ChartOptionParams): EChartsOption => {
    const {
        xs,
        btActual,
        etActual,
        rorActual,
        currentTimeSec,
        charged,
        eventMarkerStyle,
        eventMarkers,
        turningPoints,
        temperatureUnit,
        showET,
        showTargetCurve,
        targetXs,
        targetBt,
        showRoR,
        showRoRET,
        rorEtActual,
        controlData,
        showControlDrum,
        showControlHeat,
        showControlFan,
        controlChartHeightPct,
        controlYMin,
        controlYMax,
        phaseSegments,
        showFcBand = true,
        tempMinC,
        tempMaxC,
        rorYMin,
        rorYMax,
        xViewMin,
        xViewMax,
        colors,
    } = params;

    const { axisLabelStyle, axisNameStyle, rightYAxisLabel } = buildAxisStyles(colors);
    const { tempYMin, tempYMax } = computeTempYRange(tempMinC, tempMaxC, temperatureUnit);

    // formatTemp와 동일: °+C/F (℃/℉ 단일 글리프는 monospace에서 깨짐)
    const unitLabel = temperatureUnit === 'C' ? '°C' : '°F';
    const rorUnit = temperatureUnit === 'C' ? '℃/min' : '℉/min';

    const formatAxisTooltip = createAxisTooltipFormatter({
        showET,
        showRoR,
        showRoRET,
        controlData,
        unitLabel,
        rorUnit,
        colors,
    });

    // cross: base(x) → lineStyle (세로선), other(y) → crossStyle (가로선)
    // 좌 temp / 우 RoR 모두 축 라벨 표시. control 보조 우축은 끔.
    // label: 축 옆 값 표시 (x=시간, y=온도·RoR·제어값)
    const crossLineStyle = buildCrossLineStyle(colors);
    const tooltipCrossPointer = buildTooltipCrossPointer(crossLineStyle);
    const xAxisPointer = buildXAxisPointer(crossLineStyle);
    const yAxisPointer = buildYAxisPointer(crossLineStyle);

    const xMin = xViewMin ?? xs[0] ?? 0;
    const xMax = xViewMax ?? xs[xs.length - 1] ?? 1200;

    const hasControlSeries = !!controlData && (showControlDrum || showControlHeat || showControlFan);
    const { usePointMarkers, allMarkLines, markPointData, fcMarkArea, controlGuideMarkLines, tempBottomBorderLine } =
        buildMarkers({
            charged,
            currentTimeSec,
            xMin,
            xMax,
            eventMarkerStyle,
            eventMarkers,
            turningPoints,
            temperatureUnit,
            unitLabel,
            xs,
            btActual,
            colors,
            tempYMin,
            hasControlSeries,
            showFcBand,
        });

    const hasRightYAxis = showRoR || hasControlSeries;
    const { leftMargin, rightMargin, topMargin } = computeGridMargins(hasRightYAxis);

    const tempSeries = buildTempSeries({
        xs,
        btActual,
        etActual,
        rorActual,
        rorEtActual,
        showTargetCurve,
        targetXs,
        targetBt,
        showET,
        showRoR,
        showRoRET,
        colors,
        usePointMarkers,
        allMarkLines,
        markPointData,
        fcMarkArea,
        tempBottomBorderLine,
    });

    const hasPhaseBar = phaseSegments.length > 0;
    const phaseSeries = hasPhaseBar
        ? buildPhaseSeries({ phaseSegments, tempMinC, tempMaxC, temperatureUnit, colors })
        : null;

    if (hasControlSeries && controlData) {
        // Grid: [0] Temp/RoR (+ phase overlay) · [1] Drum/Heat/Fan
        const { grid, xAxis, yAxis } = buildDualGridLayout({
            leftMargin,
            rightMargin,
            topMargin,
            controlChartHeightPct,
            xMin,
            xMax,
            tempYMin,
            tempYMax,
            rorYMin,
            rorYMax,
            controlYMin,
            controlYMax,
            colors,
            axisLabelStyle,
            axisNameStyle,
            rightYAxisLabel,
            xAxisPointer,
            yAxisPointer,
        });

        const controlSeries = buildControlSeries({
            controlData,
            showControlDrum,
            showControlHeat,
            showControlFan,
            colors,
            controlGuideMarkLines,
        });

        return {
            backgroundColor: 'transparent',
            animation: false,
            axisPointer: {
                link: [{ xAxisIndex: [0, 1] }],
                animation: false,
                lineStyle: crossLineStyle,
            },
            grid,
            xAxis,
            yAxis,
            tooltip: {
                trigger: 'axis',
                backgroundColor: colors.tooltipBg,
                borderWidth: 1,
                borderColor: colors.tooltipBorder,
                extraCssText: 'box-shadow: none;',
                axisPointer: tooltipCrossPointer,
                formatter: formatAxisTooltip,
            },
            series: [...tempSeries, ...controlSeries, ...(phaseSeries ? [phaseSeries] : [])],
            // Zoom/pan owned by useChartZoom — ECharts dataZoom would steal drag/wheel
            dataZoom: [],
        };
    }

    const { grid, xAxis, yAxis } = buildSingleGridLayout({
        leftMargin,
        rightMargin,
        topMargin,
        xMin,
        xMax,
        tempYMin,
        tempYMax,
        rorYMin,
        rorYMax,
        colors,
        axisLabelStyle,
        axisNameStyle,
        rightYAxisLabel,
        xAxisPointer,
        yAxisPointer,
    });

    return {
        backgroundColor: 'transparent',
        animation: false,
        grid,
        tooltip: {
            trigger: 'axis',
            backgroundColor: colors.tooltipBg,
            borderWidth: 1,
            borderColor: colors.tooltipBorder,
            extraCssText: 'box-shadow: none;',
            axisPointer: tooltipCrossPointer,
            formatter: formatAxisTooltip,
        },
        dataZoom: [],
        xAxis,
        yAxis,
        series: [...tempSeries, ...(phaseSeries ? [phaseSeries] : [])],
    };
};
