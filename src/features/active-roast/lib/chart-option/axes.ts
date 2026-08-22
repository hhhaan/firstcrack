import type { TemperatureUnit } from '@features/active-roast';
import {
    AXIS_LABEL_FONT,
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
import { toDisplayTemp } from '@features/active-roast/lib/temperature';
import { formatElapsed } from '@shared/lib/format';
import type { EChartsOption } from 'echarts';
import type { ResolvedChartColors } from './types';

export const fmtSec = (v: number) => `${v < 0 ? '-' : ''}${formatElapsed(Math.abs(v))}`;

/** Labels only at 0, 50, 100… — not from axis min (e.g. 20→300 → 50…300) */
export const formatTempYLabel = (v: number) => {
    const n = Math.round(Number(v));
    return n % TEMP_Y_LABEL_INTERVAL === 0 ? String(n) : '';
};

export const computeTempYRange = (tempMinC: number, tempMaxC: number, temperatureUnit: TemperatureUnit) => {
    // Align scale to grid step so ticks hit multiples of 10 (and thus 50)
    const tempYMinRaw = toDisplayTemp(tempMinC, temperatureUnit);
    const tempYMaxRaw = toDisplayTemp(tempMaxC, temperatureUnit);
    const tempYMin = Math.floor(tempYMinRaw / TEMP_Y_INTERVAL) * TEMP_Y_INTERVAL;
    const tempYMax = Math.ceil(tempYMaxRaw / TEMP_Y_INTERVAL) * TEMP_Y_INTERVAL;
    return { tempYMin, tempYMax };
};

export const buildAxisStyles = (colors: ResolvedChartColors) => {
    const axisLabelStyle = { ...AXIS_LABEL_FONT, color: colors.axisLabel };
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

export const computeGridMargins = (hasRightYAxis: boolean) => {
    const rightMargin = hasRightYAxis ? CHART_GRID_RIGHT_WITH_ROR : CHART_GRID_RIGHT;
    const leftMargin = CHART_GRID_LEFT;
    const topMargin = CHART_GRID_TOP;
    return { leftMargin, rightMargin, topMargin };
};

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
    controlYMin: number;
    controlYMax: number;
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
        controlYMin,
        controlYMax,
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
        { left: leftMargin, right: rightMargin, top: controlGridTop, bottom: CONTROL_GRID_BOTTOM },
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
            gridIndex: 1,
            type: 'value',
            nameLocation: 'middle',
            nameGap: Y_AXIS_NAME_GAP,
            nameTextStyle: axisNameStyle,
            position: 'left',
            axisLine: { onZero: false },
            axisTick: { show: false },
            axisLabel: { show: false },
            axisPointer: yAxisPointer,
            splitLine: { show: true, lineStyle: { color: colors.gridLine } },
            min: controlYMin,
            max: controlYMax,
        },
        {
            gridIndex: 1,
            type: 'value',
            nameLocation: 'middle',
            nameGap: Y_AXIS_NAME_GAP,
            nameTextStyle: axisNameStyle,
            position: 'right',
            axisLine: { onZero: false },
            axisTick: { show: false },
            axisLabel: { show: false },
            axisPointer: yAxisPointerOff,
            splitLine: { show: false },
            min: controlYMin,
            max: controlYMax,
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

    const grid = [{ left: leftMargin, right: rightMargin, top: topMargin, bottom: SINGLE_GRID_BOTTOM }];

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
