import { chartFontScale, scaleChartPx } from '@features/active-roast/lib/chart-config';
import { canvasCurveTokens, DEFAULT_CURVE_STYLES, resolveCurveStyles } from '@features/active-roast/lib/curve-style';
import { rorUnitLabel, tempUnitLabel, toDisplayRoR } from '@features/active-roast/lib/temperature';
import type { EChartsOption } from 'echarts';
import {
    applyChartAxisSettings,
    applyReportAxes,
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
import { buildControlSeries, buildCurveLabelSeries, buildPhaseSeries, buildTempSeries } from './series';
import { createAxisTooltipFormatter, lastDrawnSampleSec } from './tooltip';
import type { ChartOptionParams } from './types';

export { fmtSec } from './axes';
export { buildCompareChartOption, type CompareChartSeries, compareChartXMax } from './compare';
export type { ChartOptionParams, ControlData, ResolvedChartColors, RoastEventMarker } from './types';

export const buildRoastChartOption = (params: ChartOptionParams): EChartsOption => {
    const {
        report = false,
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
        showTargetDeltaLabel = false,
        showProfileBt,
        showProfileEt,
        showProfileRor,
        showProfileEtRor,
        showProfileDrum,
        showProfileHeat,
        showProfileFan,
        targetXs,
        targetBt,
        targetEt,
        targetRor,
        targetEtRor,
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
        bbpRange,
        hideChargeLabel = false,
        fontScale: fontScaleRaw,
        colors,
        curveStyles = DEFAULT_CURVE_STYLES,
    } = params;
    const curves = resolveCurveStyles(curveStyles, canvasCurveTokens(colors));

    const fontScale = chartFontScale(fontScaleRaw);
    const { axisLabelStyle, axisNameStyle, rightYAxisLabel } = buildAxisStyles(colors);
    const { tempYMin, tempYMax } = computeTempYRange(
        tempMinC,
        tempMaxC,
        temperatureUnit,
        params.axisSettings?.tempTicksC?.length ? undefined : params.axisSettings?.tempGridInterval || undefined,
    );
    const rorYMinDisp = toDisplayRoR(rorYMin, temperatureUnit);
    const rorYMaxDisp = toDisplayRoR(rorYMax, temperatureUnit);

    const unitLabel = tempUnitLabel(temperatureUnit);
    const rorUnit = rorUnitLabel(temperatureUnit);

    const dataEndSec = lastDrawnSampleSec(xs, [btActual, etActual, rorActual, rorEtActual], controlData);
    const formatAxisTooltip = createAxisTooltipFormatter({
        showET,
        showRoR,
        showRoRET,
        showControlHeat,
        controlData,
        unitLabel,
        rorUnit,
        curves,
        dataEndSec,
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
    const reportGridInterval = params.axisSettings?.tempTicksC?.length
        ? undefined
        : params.axisSettings?.tempGridInterval;
    const tuneAxes = (axes: Parameters<typeof applyChartAxisSettings>[0]) => {
        if (report) applyReportAxes(axes, colors, xMax - xMin, temperatureUnit, reportGridInterval);
        applyChartAxisSettings(axes, params.axisSettings, temperatureUnit);
    };

    const bbpBackground = (control: boolean) => ({
        id: control ? 'bbp-control-background' : 'bbp-background',
        type: 'line' as const,
        xAxisIndex: control ? 1 : 0,
        yAxisIndex: control ? 2 : 0,
        data: [],
        silent: true,
        z: 0,
        tooltip: { show: false },
        markArea: {
            silent: true,
            itemStyle: { color: colors.bbpFill },
            label: {
                show: !control,
                position: 'insideTopLeft' as const,
                color: colors.axisLabel,
                fontSize: scaleChartPx(12, fontScale),
            },
            data: showBbp
                ? [
                      [
                          { name: bbpRange?.label ?? 'BBP', xAxis: Math.max(xMin, bbpRange?.start ?? 0) },
                          { xAxis: Math.min(xMax, bbpRange?.end ?? 0) },
                      ],
                  ]
                : [],
        },
    });
    const showBbp = bbpRange && bbpRange.start < xMax && bbpRange.end > xMin;

    const profileOn = (flag: boolean | undefined) => flag !== false;
    const reference = controlData?.reference;
    const profileControl =
        showTargetCurve &&
        !!reference?.xs.length &&
        ((profileOn(showProfileDrum) && reference.drum.some((value) => value != null)) ||
            (profileOn(showProfileHeat) && reference.heater.some((value) => value != null)) ||
            (profileOn(showProfileFan) && reference.fan.some((value) => value != null)));
    const hasControlSeries = !!controlData && (showControlDrum || showControlHeat || showControlFan || profileControl);
    const { allMarkLines, markPointData, curveLabels, fcMarkArea, controlGuideMarkLines, tempBottomBorderLine } =
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
            tempYMax,
            hasControlSeries,
            showFcBand,
            showTargetDeltaLabel,
            targetXs,
            targetBt,
            hideChargeLabel,
            fontScale,
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
        showProfileBt,
        showProfileEt,
        showProfileRor,
        showProfileEtRor,
        targetXs,
        targetBt,
        targetEt,
        targetRor,
        targetEtRor,
        showET,
        showRoR,
        showRoRET,
        curves,
        allMarkLines,
        markPointData,
        fcMarkArea,
        tempBottomBorderLine: report ? null : tempBottomBorderLine,
    });

    const hasPhaseBar = phaseSegments.length > 0;
    const phaseSeries = hasPhaseBar
        ? buildPhaseSeries({ phaseSegments, tempMinC, tempMaxC, temperatureUnit, colors, fontScale })
        : null;
    // Always present so a zoom that culls every label still updates this series.
    // Omitting it on merge leaves the previous frame's text on the canvas.
    const curveLabelSeries = buildCurveLabelSeries(curveLabels, fontScale);

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
            rorYMin: rorYMinDisp,
            rorYMax: rorYMaxDisp,
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
            showTargetCurve,
            showProfileDrum,
            showProfileHeat,
            showProfileFan,
            showControlDrum,
            showControlHeat,
            showControlFan,
            curves,
            controlGuideMarkLines,
            fontScale,
        });

        tuneAxes({ xAxis, yAxis });

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
            series: [
                ...(bbpRange ? [bbpBackground(false), bbpBackground(true)] : []),
                ...tempSeries,
                ...controlSeries,
                curveLabelSeries,
                ...(phaseSeries ? [phaseSeries] : []),
            ],
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
        rorYMin: rorYMinDisp,
        rorYMax: rorYMaxDisp,
        colors,
        axisLabelStyle,
        axisNameStyle,
        rightYAxisLabel,
        xAxisPointer,
        yAxisPointer,
    });

    tuneAxes({ xAxis, yAxis });

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
        series: [
            ...(bbpRange ? [bbpBackground(false)] : []),
            ...tempSeries,
            curveLabelSeries,
            ...(phaseSeries ? [phaseSeries] : []),
        ],
    };
};
