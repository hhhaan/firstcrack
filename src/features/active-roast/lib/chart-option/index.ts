import { chartFontScale, scaleChartPx, TEMP_Y_INTERVAL } from '@features/active-roast/lib/chart-config';
import { canvasCurveTokens, DEFAULT_CURVE_STYLES, resolveCurveStyles } from '@features/active-roast/lib/curve-style';
import { rorUnitLabel, tempUnitLabel, toDisplayRoR } from '@features/active-roast/lib/temperature';
import { roastPdfLayout } from '@shared/lib/roast-pdf-layout';
import type { EChartsOption } from 'echarts';
import {
    applyChartAxisSettings,
    applyPrintAxes,
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
export {
    buildCompareChartOption,
    COMPARE_GRID_LEFT,
    COMPARE_GRID_RIGHT,
    type CompareChartSeries,
    compareChartRightMargin,
    compareChartXMax,
} from './compare';
export { compareChannels, isCompareControlChannel } from './compare-channels';
export type { ChartOptionParams, ControlData, ResolvedChartColors, RoastEventMarker } from './types';

export const buildRoastChartOption = (params: ChartOptionParams): EChartsOption => {
    const printEnd = params.eventMarkers.find((marker) => marker.event === 'Drop')?.timeSec;
    const printRor = { min: 0, max: 5 };
    if (params.print) {
        for (const values of [params.rorActual, params.rorEtActual])
            values.forEach((value, index) => {
                const time = params.xs[index];
                if (value == null || !Number.isFinite(value) || time < 0 || (printEnd != null && time > printEnd))
                    return;
                printRor.min = Math.min(printRor.min, value);
                printRor.max = Math.max(printRor.max, value);
            });
    }
    const paper = params.print
        ? {
              ...params,
              axisSettings: undefined,
              fontScale: 1,
              showET: true,
              showRoR: true,
              showRoRET: params.rorEtActual.some((value) => value != null),
              showTargetCurve: false,
              showTargetDeltaLabel: false,
              showControlDrum: false,
              showControlFan: false,
              showControlHeat: Boolean(
                  params.controlData?.heatSet?.some((value) => value != null) ||
                      params.controlData?.heatPower.some((value) => value != null),
              ),
              eventMarkerStyle: 'point' as const,
              eventMarkers: params.eventMarkers.filter((marker) => ['FC Start', 'Drop'].includes(marker.event)),
              turningPoints: [],
              phaseSegments: [],
              showFcBand: false,
              bbpRange: undefined,
              xViewMin: 0,
              xViewMax: printEnd ?? params.xs[params.xs.length - 1],
              controlData: params.controlData
                  ? { ...params.controlData, reference: undefined, heatTarget: undefined, drumTemp: [], fanSpeed: [] }
                  : undefined,
          }
        : params;
    const {
        report: configuredReport = false,
        print = false,
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
        controlChartHeightPct: configuredControlChartHeightPct,
        mergeControlChart: configuredMergeControlChart = false,
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
    } = paper;
    const report = print || configuredReport;
    const mergeControlChart = !print && configuredMergeControlChart;
    const controlChartHeightPct = print ? 24 : configuredControlChartHeightPct;
    const curves = resolveCurveStyles(curveStyles, canvasCurveTokens(colors));
    if (print) curves.etRor.current.type = 'dashed';

    const fontScale = chartFontScale(fontScaleRaw);
    const { axisLabelStyle, axisNameStyle, rightYAxisLabel } = buildAxisStyles(colors);
    const { tempYMin, tempYMax } = computeTempYRange(tempMinC, tempMaxC, temperatureUnit);
    const rorStep = temperatureUnit === 'F' ? 10 : 5;
    const rorYMinDisp = print ? Math.floor(printRor.min / rorStep) * rorStep : toDisplayRoR(rorYMin, temperatureUnit);
    const rorYMaxDisp = print ? Math.ceil(printRor.max / rorStep) * rorStep : toDisplayRoR(rorYMax, temperatureUnit);

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
    const reportGridInterval = paper.axisSettings ? TEMP_Y_INTERVAL : undefined;
    const tuneAxes = (axes: Parameters<typeof applyChartAxisSettings>[0]) => {
        if (report) applyReportAxes(axes, colors, xMax - xMin, temperatureUnit, reportGridInterval);
        applyChartAxisSettings(axes, paper.axisSettings, temperatureUnit);
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
            hasControlSeries: hasControlSeries && !mergeControlChart,
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
    const curveLabelSeries = buildCurveLabelSeries(
        curveLabels,
        fontScale,
        print ? '#ffffff' : undefined,
        print ? `400 ${roastPdfLayout.tickFontSize}px ${roastPdfLayout.fontFamily}` : undefined,
    );

    if (hasControlSeries && controlData) {
        // Controls keep their own value axes, including when sharing the temperature grid.
        // Physical feedback (Pa/Hz/RPM) is kept raw, never normalized to percent.
        const physicalUnits = [...(controlData.readUnits ?? []), ...(controlData.reference?.readUnits ?? [])].some(
            (units) => units && Object.values(units).some((unit) => unit !== '%'),
        );
        let readMin = controlYMin;
        let readMax = controlYMax;
        if (physicalUnits) {
            for (const values of [
                controlData.drumTemp,
                controlData.heatPower,
                controlData.fanSpeed,
                controlData.reference?.drum ?? [],
                controlData.reference?.heater ?? [],
                controlData.reference?.fan ?? [],
            ]) {
                for (const value of values) {
                    if (value != null && Number.isFinite(value)) {
                        readMin = Math.min(readMin, value);
                        readMax = Math.max(readMax, value);
                    }
                }
            }
        }
        const { grid, xAxis, yAxis } = buildDualGridLayout({
            leftMargin: print ? 40 : leftMargin,
            rightMargin: print ? 40 : rightMargin,
            topMargin,
            controlChartHeightPct,
            mergeControlChart,
            xMin,
            xMax,
            tempYMin,
            tempYMax,
            rorYMin: rorYMinDisp,
            rorYMax: rorYMaxDisp,
            controlYMin: readMin,
            controlYMax: readMax,
            colors,
            axisLabelStyle,
            axisNameStyle,
            rightYAxisLabel,
            xAxisPointer,
            yAxisPointer,
        });

        const printedHeat = controlData.heatSet?.some((value) => value != null) ? 'Heat set' : 'Heat';
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
            controlGuideMarkLines: mergeControlChart ? [] : controlGuideMarkLines,
            fontScale,
        }).filter((series) => !print || ('name' in series && series.name === printedHeat));

        tuneAxes({ xAxis, yAxis });
        if (print && Array.isArray(yAxis)) {
            const controlHeight = roastPdfLayout.chartHeight * 0.2;
            const controlTop = roastPdfLayout.chartHeight - 36 - controlHeight;
            grid[0] = { ...grid[0], top: 20, height: controlTop - roastPdfLayout.plotGap - 20 };
            grid[1] = { ...grid[1], top: controlTop, height: controlHeight, bottom: undefined };
            for (const axis of yAxis.slice(2)) {
                axis.axisLabel = { ...axisLabelStyle };
                if (axis.type === 'value') {
                    axis.interval = undefined;
                    axis.splitNumber = 2;
                }
            }
            yAxis[2].splitLine = { show: true, lineStyle: { color: colors.gridLine } };
            yAxis[3].axisLabel = { show: false };
            applyPrintAxes({ xAxis, yAxis }, temperatureUnit, printedHeat === 'Heat set' ? 'Gas' : 'Heat');
        }

        return {
            backgroundColor: 'transparent',
            animation: false,
            axisPointer: {
                link: [{ xAxisIndex: mergeControlChart ? [0] : [0, 1] }],
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
                ...(bbpRange ? [bbpBackground(false)] : []),
                ...(bbpRange && !mergeControlChart ? [bbpBackground(true)] : []),
                ...tempSeries,
                ...controlSeries.map((series) => ({
                    ...series,
                    xAxisIndex: mergeControlChart ? 0 : 1,
                    ...(print ? { markPoint: { data: [] } } : {}),
                })),
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

    if (print) applyPrintAxes({ xAxis, yAxis }, temperatureUnit);

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
