import { chartFontScale, scaleChartPx } from '@features/active-roast/lib/chart-config';
import { rorUnitLabel, tempUnitLabel, toDisplayRoR } from '@features/active-roast/lib/temperature';
import type { EChartsOption } from 'echarts';
import {
    type ControlChannel,
    DEFAULT_CONTROL_UNITS,
    deadbandSpanForChannel,
    layoutControlAxes,
} from '../control-channels';
import { supportedChannelVisible } from '../supported-control-channels';
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
import { buildChangeLabelSeries, changeLabelDeadband, memoizedChangePoints } from './change-labels';
import { buildMarkers } from './markers';
import {
    buildContinuousMarkerSeries,
    buildControlSeries,
    buildCurveLabelSeries,
    buildPhaseSeries,
    buildTempSeries,
} from './series';
import { createAxisTooltipFormatter, lastDrawnSampleSec } from './tooltip';
import type { ChartOptionParams } from './types';

export { fmtSec } from './axes';
export { buildCompareChartOption, type CompareChartSeries, compareChartXMax } from './compare';
export type { ChartOptionParams, ControlData, ResolvedChartColors, RoastEventMarker } from './types';

/** Which control axis each channel uses. Live curves and shown reference curves both claim an axis. */
export const controlAxisLayoutFor = (
    params: Pick<
        ChartOptionParams,
        | 'controlData'
        | 'controlUnits'
        | 'controlYMin'
        | 'controlYMax'
        | 'showTargetCurve'
        | 'showControlDrum'
        | 'showControlHeat'
        | 'showControlFan'
        | 'showProfileDrum'
        | 'showProfileHeat'
        | 'showProfileFan'
        | 'supportedControls'
    >,
) => {
    const reference = params.controlData?.reference;
    const supported = params.supportedControls;
    const referenceShown = (flag: boolean | undefined, values: readonly (number | null)[] | undefined) =>
        params.showTargetCurve && !!reference?.xs.length && flag !== false && !!values?.some((value) => value != null);
    const data = params.controlData;
    const dataByChannel = data ? { drum: data.drumTemp, heat: data.heatPower, fan: data.fanSpeed } : undefined;
    return layoutControlAxes(
        {
            drum: supportedChannelVisible(
                'drum',
                params.showControlDrum || referenceShown(params.showProfileDrum, reference?.drum),
                supported,
            ),
            heat: supportedChannelVisible(
                'heat',
                params.showControlHeat || referenceShown(params.showProfileHeat, reference?.heater),
                supported,
            ),
            fan: supportedChannelVisible(
                'fan',
                params.showControlFan || referenceShown(params.showProfileFan, reference?.fan),
                supported,
            ),
        },
        params.controlUnits ?? DEFAULT_CONTROL_UNITS,
        params.controlYMin,
        params.controlYMax,
        dataByChannel,
    );
};

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
        showProfileDrum,
        showProfileHeat,
        showProfileFan,
        targetXs,
        targetBt,
        targetEt,
        targetRor,
        showRoR,
        showRoRET,
        rorEtActual,
        controlData,
        showControlDrum,
        showControlHeat,
        showControlFan,
        controlChartHeightPct,
        controlUnits = DEFAULT_CONTROL_UNITS,
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
    } = params;

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
        controlUnits,
        unitLabel,
        rorUnit,
        colors,
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
    const supported = params.supportedControls;
    const liveControlDrum = supportedChannelVisible('drum', showControlDrum, supported);
    const liveControlHeat = supportedChannelVisible('heat', showControlHeat, supported);
    const liveControlFan = supportedChannelVisible('fan', showControlFan, supported);
    const hasControlSeries = !!controlData && (liveControlDrum || liveControlHeat || liveControlFan || profileControl);
    const controlAxes = controlAxisLayoutFor({ ...params, controlUnits });
    const {
        allMarkLines,
        markPointData,
        curveLabels,
        fcMarkArea,
        controlGuideMarkLines,
        continuousMarkerLines,
        tempBottomBorderLine,
    } = buildMarkers({
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
        targetXs,
        targetBt,
        targetEt,
        targetRor,
        showET,
        showRoR,
        showRoRET,
        colors,
        allMarkLines,
        markPointData,
        fcMarkArea,
        tempBottomBorderLine: report ? null : tempBottomBorderLine,
    });

    const hasPhaseBar = phaseSegments.length > 0;
    const phaseSeries = hasPhaseBar
        ? buildPhaseSeries({ phaseSegments, tempMinC, tempMaxC, temperatureUnit, colors, fontScale })
        : null;
    const continuousMarkerSeries =
        eventMarkerStyle === 'both'
            ? buildContinuousMarkerSeries(
                  report
                      ? continuousMarkerLines.map((line) => ({
                            ...line,
                            width: 0.6,
                            color: line.color === colors.eventControl ? colors.eventControl : colors.phaseLines,
                        }))
                      : continuousMarkerLines,
                  (tempYMin + tempYMax) / 2,
                  hasControlSeries,
              )
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
            controlAxes,
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
            showControlDrum: liveControlDrum,
            showControlHeat: liveControlHeat,
            showControlFan: liveControlFan,
            colors,
            controlGuideMarkLines,
            axisOf: controlAxes.axisOf,
        });
        const sideOf = (channel: ControlChannel) =>
            [controlAxes.left, controlAxes.right, controlAxes.ownScale][controlAxes.axisOf[channel] - 2];
        const labelSeries = controlData.changeLabels ?? {
            xs: controlData.xs,
            drumTemp: controlData.drumTemp,
            heatPower: controlData.heatPower,
            fanSpeed: controlData.fanSpeed,
        };
        const measured: [ControlChannel, boolean, (number | null)[], string][] = [
            ['drum', liveControlDrum, labelSeries.drumTemp, colors.controlDrum],
            ['heat', liveControlHeat, labelSeries.heatPower, colors.controlHeat],
            ['fan', liveControlFan, labelSeries.fanSpeed, colors.controlFan],
        ];
        const units = params.controlUnits ?? DEFAULT_CONTROL_UNITS;
        // Always present so a zoom that culls every label still clears the previous frame.
        const changeLabelSeries = buildChangeLabelSeries(
            measured
                .filter(([channel, shown]) => supportedChannelVisible(channel, shown, supported))
                .map(([channel, , values, color]) => {
                    const side = sideOf(channel);
                    const span = deadbandSpanForChannel(channel, units, values, side);
                    const deadband = changeLabelDeadband(span.min, span.max, units[channel].unit);
                    return {
                        channel,
                        color,
                        points: memoizedChangePoints(labelSeries.xs, values, deadband),
                        min: side.min,
                        max: side.max,
                    };
                }),
            { haloColor: colors.controlLabelHalo, xDomain: { min: xMin, max: xMax } },
        );

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
                changeLabelSeries,
                ...(continuousMarkerSeries ? [continuousMarkerSeries] : []),
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
            ...(continuousMarkerSeries ? [continuousMarkerSeries] : []),
            curveLabelSeries,
            ...(phaseSeries ? [phaseSeries] : []),
        ],
    };
};
