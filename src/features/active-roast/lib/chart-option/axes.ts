import type { TemperatureUnit } from '@features/active-roast';
import {
    AXIS_LABEL_FONT,
    AXIS_LABEL_FONT_SM,
    AXIS_MINOR_SPLIT_NUMBER,
    CHART_GRID_LEFT,
    CHART_GRID_RIGHT,
    CHART_GRID_RIGHT_WITH_ROR,
    CHART_GRID_TOP,
    CONTROL_GRID_BOTTOM,
    getControlGridLayout,
    SINGLE_GRID_BOTTOM,
    TEMP_Y_INTERVAL,
    TEMP_Y_LABEL_INTERVAL,
    TIME_X_INTERVAL_SEC,
    Y_AXIS_NAME_GAP,
} from '@features/active-roast/lib/chart-config';
import {
    CONTROL_CHANNEL_LABEL,
    type ControlAxisLayout,
    type ControlAxisSide,
} from '@features/active-roast/lib/control-channels';
import { toDisplayTemp } from '@features/active-roast/lib/temperature';
import { formatElapsed } from '@shared/lib/format';
import type { EChartsOption } from 'echarts';
import type { ChartOptionParams, ResolvedChartColors } from './types';

export const fmtSec = (v: number) => `${v < 0 ? '-' : ''}${formatElapsed(Math.abs(v))}`;

/** Labels only at 0, 50, 100… — not from axis min (e.g. 20→300 → 50…300) */
export const formatTempYLabel = (v: number) => {
    const n = Math.round(Number(v));
    return n % TEMP_Y_LABEL_INTERVAL === 0 ? String(n) : '';
};

export const computeTempYRange = (
    tempMinC: number,
    tempMaxC: number,
    temperatureUnit: TemperatureUnit,
    interval = TEMP_Y_INTERVAL,
) => {
    // Align display-unit bounds so grid lines and numeric labels share an origin.
    const tempYMinRaw = toDisplayTemp(tempMinC, temperatureUnit);
    const tempYMaxRaw = toDisplayTemp(tempMaxC, temperatureUnit);
    const tempYMin = Math.floor(tempYMinRaw / interval) * interval;
    const tempYMax = Math.ceil(tempYMaxRaw / interval) * interval;
    return { tempYMin, tempYMax };
};

export const buildAxisStyles = (colors: ResolvedChartColors) => {
    const axisLabelStyle = {
        ...AXIS_LABEL_FONT,
        color: colors.axisLabel,
    };
    const axisNameStyle = { color: colors.axisLabel };
    const rightYAxisLabel = { ...axisLabelStyle, margin: 4 };
    return { axisLabelStyle, axisNameStyle, rightYAxisLabel };
};

export const buildCrossLineStyle = (colors: ResolvedChartColors) => ({
    color: colors.axisPointerLine,
    width: 1,
    type: 'solid' as const,
});

export const buildTooltipCrossPointer = (crossLineStyle: ReturnType<typeof buildCrossLineStyle>) => ({
    type: 'cross' as const,
    snap: false,
    animation: false,
    label: { show: true },
    lineStyle: crossLineStyle,
    crossStyle: crossLineStyle,
});

// ECharts LabelFormatterParams.value = ScaleDataValue (number | string | Date)
export const buildXAxisPointer = (crossLineStyle: ReturnType<typeof buildCrossLineStyle>) => ({
    show: true,
    type: 'line' as const,
    animation: false,
    snap: false,
    label: {
        show: true,
        formatter: (p: { value: unknown }) => fmtSec(Number(p.value)),
    },
    lineStyle: crossLineStyle,
});

export const buildYAxisPointer = (crossLineStyle: ReturnType<typeof buildCrossLineStyle>) => ({
    show: true,
    type: 'line' as const,
    animation: false,
    label: {
        show: true,
        formatter: (p: { value: unknown }) => {
            const n = Number(p.value);
            return Number.isFinite(n) ? n.toFixed(1) : '';
        },
    },
    lineStyle: crossLineStyle,
});

export const yAxisPointerOff = { show: false };

const formatTick = (value: number): string => String(Number(value.toFixed(6)));

const matchesTick = (value: number, interval: number): boolean =>
    Math.abs(value / interval - Math.round(value / interval)) < 1e-6;

const reportTimeIntervalSec = (durationSec: number): number => {
    if (durationSec <= 60) return 5;
    if (durationSec <= 180) return 15;
    return Math.max(60, Math.ceil(durationSec / 600) * 60);
};

const reportTempInterval = (span: number, override: number): number => {
    if (override) return override;
    if (span <= 50) return 10;
    if (span <= 120) return 20;
    return 50;
};

export const applyChartAxisSettings = (
    axes: Pick<EChartsOption, 'xAxis' | 'yAxis'>,
    settings: ChartOptionParams['axisSettings'],
    temperatureUnit: TemperatureUnit,
) => {
    if (!settings) return;
    for (const axis of Array.isArray(axes.xAxis) ? axes.xAxis : []) {
        if (axis.type === 'value' && settings.timeTickIntervalSec > 0) axis.interval = settings.timeTickIntervalSec;
        axis.axisLabel = { ...axis.axisLabel, hideOverlap: true };
    }
    const temperatureAxis = (Array.isArray(axes.yAxis) ? axes.yAxis : []).find(
        (axis) => axis.gridIndex === 0 && axis.position !== 'right',
    );
    if (temperatureAxis?.type !== 'value') return;
    const ticks = settings.tempTicksC?.map((value) => toDisplayTemp(value, temperatureUnit));
    const customValues = ticks?.length ? ticks : undefined;
    temperatureAxis.axisTick = { ...temperatureAxis.axisTick, customValues };
    temperatureAxis.axisLabel = { ...temperatureAxis.axisLabel, customValues, hideOverlap: true };
    if (customValues) {
        temperatureAxis.axisLabel.formatter = formatTick;
        return;
    }
    if (settings.tempGridInterval > 0) {
        temperatureAxis.interval = settings.tempGridInterval;
    }
    if (settings.tempLabelEvery > 0 || settings.tempGridInterval > 0) {
        const interval = Number(temperatureAxis.interval) * (settings.tempLabelEvery || 1);
        temperatureAxis.axisLabel = {
            ...temperatureAxis.axisLabel,
            formatter: (value: number) => (matchesTick(value, interval) ? formatTick(value) : ''),
        };
    }
};

export const applyReportAxes = (
    axes: Pick<EChartsOption, 'xAxis' | 'yAxis'>,
    colors: ResolvedChartColors,
    durationSec: number,
    temperatureUnit: TemperatureUnit,
    tempGridInterval = 0,
) => {
    for (const axis of Array.isArray(axes.xAxis) ? axes.xAxis : []) {
        axis.axisLine = { show: false };
        axis.splitLine = { show: false };
        axis.minorSplitLine = { show: false };
        if (axis.type === 'value') {
            axis.interval = reportTimeIntervalSec(durationSec);
            axis.axisLabel = { ...axis.axisLabel, hideOverlap: true };
        }
    }
    for (const axis of Array.isArray(axes.yAxis) ? axes.yAxis : []) {
        axis.axisLine = { show: false };
        axis.splitLine = {
            show: axis.gridIndex === 0 && axis.position !== 'right',
            lineStyle: { color: colors.gridLine, width: 0.6, type: 'dashed' },
        };
        if (axis.type === 'value' && axis.gridIndex === 0) {
            axis.interval = axis.position === 'right' ? (temperatureUnit === 'F' ? 10 : 5) : 50;
            if (axis.position !== 'right') {
                const span = Number(axis.max) - Number(axis.min);
                axis.interval = reportTempInterval(span, tempGridInterval);
                axis.min = Math.floor(Number(axis.min) / axis.interval) * axis.interval;
                axis.max = Math.ceil(Number(axis.max) / axis.interval) * axis.interval;
                axis.axisLabel = { ...axis.axisLabel, formatter: (value: number) => String(Math.round(value)) };
            }
        }
    }
};

export const computeGridMargins = (hasRightYAxis: boolean) => {
    const rightMargin = hasRightYAxis ? CHART_GRID_RIGHT_WITH_ROR : CHART_GRID_RIGHT;
    const leftMargin = CHART_GRID_LEFT;
    const topMargin = CHART_GRID_TOP;
    return { leftMargin, rightMargin, topMargin };
};

export const controlAxisName = (side: ControlAxisSide): string =>
    side.unit == null
        ? ''
        : `${side.channels.map((channel) => CONTROL_CHANNEL_LABEL[channel]).join(' · ')} (${side.unit})`;

/**
 * Control band axis: numbers only when a shown channel is drawn on it.
 * The name ("Heat · Fan (%)") sits inward over the gap above the band so it never meets
 * the temperature/RoR tick labels in the margins. Two ticks keep the short band readable.
 */
export const controlAxisScale = (
    side: ControlAxisSide,
    labelStyle: ReturnType<typeof buildAxisStyles>['axisLabelStyle'],
    nameStyle: ReturnType<typeof buildAxisStyles>['axisNameStyle'],
    position: 'left' | 'right',
) => ({
    min: side.min,
    max: side.max,
    splitNumber: 2,
    name: controlAxisName(side),
    nameLocation: 'end' as const,
    nameGap: 2,
    nameTextStyle: { ...nameStyle, ...AXIS_LABEL_FONT_SM, align: position, verticalAlign: 'bottom' as const },
    axisLabel: { ...labelStyle, show: side.unit != null, hideOverlap: true, formatter: formatControlTick },
});

const formatControlTick = (value: number) => String(Number(value.toFixed(2)));

export interface DualGridAxesParams {
    leftMargin: number;
    rightMargin: number;
    topMargin: number;
    controlChartHeightPct: number;
    xMin: number;
    xMax: number;
    tempYMin: number;
    tempYMax: number;
    rorYMin: number;
    rorYMax: number;
    controlAxes: ControlAxisLayout;
    colors: ResolvedChartColors;
    axisLabelStyle: ReturnType<typeof buildAxisStyles>['axisLabelStyle'];
    axisNameStyle: ReturnType<typeof buildAxisStyles>['axisNameStyle'];
    rightYAxisLabel: ReturnType<typeof buildAxisStyles>['rightYAxisLabel'];
    xAxisPointer: ReturnType<typeof buildXAxisPointer>;
    yAxisPointer: ReturnType<typeof buildYAxisPointer>;
}

export const buildDualGridLayout = (params: DualGridAxesParams) => {
    const {
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
        controlAxes,
        colors,
        axisLabelStyle,
        axisNameStyle,
        rightYAxisLabel,
        xAxisPointer,
        yAxisPointer,
    } = params;
    const { tempGridHeight, controlGridTop } = getControlGridLayout(controlChartHeightPct);

    const grid = [
        { left: leftMargin, right: rightMargin, top: topMargin, height: tempGridHeight },
        {
            left: leftMargin,
            right: rightMargin,
            top: controlGridTop,
            bottom: CONTROL_GRID_BOTTOM,
        },
    ];

    const xAxis = [
        {
            gridIndex: 0,
            type: 'value' as const,
            min: xMin,
            max: xMax,
            axisLabel: { show: false },
            axisTick: { show: false },
            axisLine: { show: false },
            // dual grid: 시간 라벨은 하단 x축만
            axisPointer: { ...xAxisPointer, label: { show: false } },
            splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 0.5 } },
            // labels 60s; minor lines → 30s grid
            interval: TIME_X_INTERVAL_SEC,
            minorTick: { show: false, splitNumber: AXIS_MINOR_SPLIT_NUMBER },
            minorSplitLine: { show: true, lineStyle: { color: colors.gridLineMinor, width: 0.5 } },
            splitNumber: 15,
        },
        {
            gridIndex: 1,
            type: 'value' as const,
            min: xMin,
            max: xMax,
            axisLabel: { formatter: fmtSec, ...axisLabelStyle },
            axisTick: { show: false },
            axisPointer: xAxisPointer,
            interval: TIME_X_INTERVAL_SEC,
            minorTick: { show: false, splitNumber: AXIS_MINOR_SPLIT_NUMBER },
            minorSplitLine: { show: true, lineStyle: { color: colors.gridLineMinor, width: 0.5 } },
            splitNumber: 15,
            splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 0.5 } },
        },
    ] as EChartsOption['xAxis'];

    const yAxis = [
        {
            gridIndex: 0,
            type: 'value',
            nameLocation: 'middle',
            nameGap: Y_AXIS_NAME_GAP,
            nameTextStyle: axisNameStyle,
            axisLine: { onZero: false },
            axisTick: { show: false },
            axisLabel: { ...axisLabelStyle, formatter: formatTempYLabel },
            axisPointer: yAxisPointer,
            splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 0.5 } },
            minorTick: { show: false },
            minorSplitLine: { show: false },
            min: tempYMin,
            max: tempYMax,
            interval: TEMP_Y_INTERVAL,
        },
        {
            gridIndex: 0,
            type: 'value',
            nameLocation: 'middle',
            nameGap: Y_AXIS_NAME_GAP,
            nameTextStyle: axisNameStyle,
            position: 'right',
            axisLine: { onZero: false },
            axisTick: { show: false },
            axisLabel: rightYAxisLabel,
            axisPointer: yAxisPointer,
            splitLine: { show: false },
            min: rorYMin,
            max: rorYMax,
            interval: 20,
        },
        {
            ...controlAxisScale(controlAxes.left, axisLabelStyle, axisNameStyle, 'left'),
            gridIndex: 1,
            type: 'value',
            position: 'left',
            axisLine: { onZero: false },
            axisTick: { show: false },
            axisPointer: yAxisPointer,
            splitLine: { show: true, lineStyle: { color: colors.gridLine } },
        },
        {
            ...controlAxisScale(controlAxes.right, rightYAxisLabel, axisNameStyle, 'right'),
            gridIndex: 1,
            type: 'value',
            position: 'right',
            axisLine: { onZero: false },
            axisTick: { show: false },
            axisPointer: yAxisPointerOff,
            splitLine: { show: false },
        },
        {
            ...controlAxisScale(controlAxes.ownScale, axisLabelStyle, axisNameStyle, 'right'),
            gridIndex: 1,
            type: 'value',
            show: controlAxes.ownScale.channels.length > 0,
            position: 'right',
            offset: 28,
            axisLine: { show: false },
            axisTick: { show: false },
            axisPointer: yAxisPointerOff,
            splitLine: { show: false },
            axisLabel: {
                ...axisLabelStyle,
                ...AXIS_LABEL_FONT_SM,
                show: controlAxes.ownScale.channels.length > 0,
                inside: true,
                hideOverlap: true,
                formatter: formatControlTick,
            },
        },
    ] as EChartsOption['yAxis'];

    return { grid, xAxis, yAxis };
};

export interface SingleGridAxesParams {
    leftMargin: number;
    rightMargin: number;
    topMargin: number;
    xMin: number;
    xMax: number;
    tempYMin: number;
    tempYMax: number;
    rorYMin: number;
    rorYMax: number;
    colors: ResolvedChartColors;
    axisLabelStyle: ReturnType<typeof buildAxisStyles>['axisLabelStyle'];
    axisNameStyle: ReturnType<typeof buildAxisStyles>['axisNameStyle'];
    rightYAxisLabel: ReturnType<typeof buildAxisStyles>['rightYAxisLabel'];
    xAxisPointer: ReturnType<typeof buildXAxisPointer>;
    yAxisPointer: ReturnType<typeof buildYAxisPointer>;
}

export const buildSingleGridLayout = (params: SingleGridAxesParams) => {
    const {
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
    } = params;

    const grid = [
        {
            left: leftMargin,
            right: rightMargin,
            top: topMargin,
            bottom: SINGLE_GRID_BOTTOM,
        },
    ];

    const xAxis = [
        {
            gridIndex: 0,
            type: 'value' as const,
            nameLocation: 'middle' as const,
            nameGap: 16,
            nameTextStyle: axisNameStyle,
            min: xMin,
            max: xMax,
            axisLabel: { formatter: (v: number) => fmtSec(v), ...axisLabelStyle },
            axisPointer: xAxisPointer,
            interval: TIME_X_INTERVAL_SEC,
            minorTick: { show: false, splitNumber: AXIS_MINOR_SPLIT_NUMBER },
            minorSplitLine: { show: true, lineStyle: { color: colors.gridLineMinor, width: 0.5 } },
            splitNumber: 15,
            splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 1 } },
        },
    ] as EChartsOption['xAxis'];

    const yAxis = [
        {
            gridIndex: 0,
            type: 'value' as const,
            nameLocation: 'middle' as const,
            nameGap: Y_AXIS_NAME_GAP,
            nameTextStyle: axisNameStyle,
            axisLine: { onZero: false },
            axisTick: { show: false },
            axisLabel: { ...axisLabelStyle, formatter: formatTempYLabel },
            axisPointer: yAxisPointer,
            splitLine: { show: true, lineStyle: { color: colors.gridLine } },
            minorTick: { show: false },
            minorSplitLine: { show: false },
            min: tempYMin,
            max: tempYMax,
            interval: TEMP_Y_INTERVAL,
        },
        {
            gridIndex: 0,
            type: 'value' as const,
            nameLocation: 'middle' as const,
            nameGap: Y_AXIS_NAME_GAP,
            nameTextStyle: axisNameStyle,
            position: 'right' as const,
            axisLine: { onZero: false },
            axisTick: { show: false },
            axisLabel: rightYAxisLabel,
            axisPointer: yAxisPointer,
            splitLine: { show: false },
            min: rorYMin,
            max: rorYMax,
            interval: 20,
        },
    ] as EChartsOption['yAxis'];

    return { grid, xAxis, yAxis };
};
