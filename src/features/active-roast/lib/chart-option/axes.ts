import {
    AXIS_LABEL_FONT,
    AXIS_LABEL_MARGIN,
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
import { toDisplayRoR, toDisplayTemp, toDisplayTempDelta } from '@features/active-roast/lib/temperature';
import { formatElapsed } from '@shared/lib/format';
import type { EChartsOption } from 'echarts';
import type { TemperatureUnit } from '../../model/settings';
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
        margin: AXIS_LABEL_MARGIN,
    };
    const axisNameStyle = { color: colors.axisLabel };
    const rightYAxisLabel = { ...axisLabelStyle };
    return { axisLabelStyle, axisNameStyle, rightYAxisLabel };
};

export const buildCrossLineStyle = (colors: ResolvedChartColors) => ({
    color: colors.axisPointerLine,
    width: 1,
    type: 'solid' as const,
});

// Hover copies the tooltip label onto every axis and drops these per-axis formatters.
type PointerLabelParam = { value: unknown; axisDimension?: string };

const formatPointerLabel = (p: PointerLabelParam) => {
    const n = Number(p.value);
    if (!Number.isFinite(n)) return '';
    return p.axisDimension === 'y' ? n.toFixed(1) : fmtSec(n);
};

export const buildTooltipCrossPointer = (crossLineStyle: ReturnType<typeof buildCrossLineStyle>) => ({
    type: 'cross' as const,
    snap: false,
    animation: false,
    label: { show: true, formatter: formatPointerLabel },
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
        formatter: (p: { value: unknown }) => formatPointerLabel({ ...p, axisDimension: 'x' }),
    },
    lineStyle: crossLineStyle,
});

export const buildYAxisPointer = (crossLineStyle: ReturnType<typeof buildCrossLineStyle>) => ({
    show: true,
    type: 'line' as const,
    animation: false,
    label: {
        show: true,
        formatter: (p: { value: unknown }) => formatPointerLabel({ ...p, axisDimension: 'y' }),
    },
    lineStyle: crossLineStyle,
});

export const yAxisPointerOff = { show: false };

const formatTick = (value: number): string => String(Number(value.toFixed(6)));

const matchesTick = (value: number, interval: number): boolean =>
    Math.abs(value / interval - Math.round(value / interval)) < 1e-6;

const ticksFromInterval = (min: number, max: number, interval: number): number[] => {
    if (!(interval > 0) || !Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
    const start = Math.ceil(min / interval - 1e-9) * interval;
    const ticks: number[] = [];
    for (let i = 0; i < 1000; i += 1) {
        const value = Number((start + i * interval).toFixed(6));
        if (value > max + 1e-9) break;
        ticks.push(value);
    }
    return ticks;
};

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
    const rorAxis = (Array.isArray(axes.yAxis) ? axes.yAxis : []).find(
        (axis) => axis.gridIndex === 0 && axis.position === 'right',
    );
    const gridInterval = settings.horizontalGridInterval
        ? toDisplayTempDelta(settings.horizontalGridInterval, temperatureUnit)
        : 0;
    if (rorAxis?.type === 'value') {
        const numberInterval = toDisplayRoR(settings.rorLabelInterval ?? 5, temperatureUnit);
        rorAxis.splitLine = { ...rorAxis.splitLine, show: false };
        if (numberInterval > 0) {
            rorAxis.interval = numberInterval;
            rorAxis.minInterval = numberInterval;
            rorAxis.maxInterval = numberInterval;
            const pointer = rorAxis.axisPointer;
            if (pointer && typeof pointer === 'object') {
                pointer.label = {
                    ...pointer.label,
                    formatter: (p: { value: unknown }) => {
                        const n = Number(p.value);
                        if (!Number.isFinite(n)) return '';
                        return formatTick(Math.round(n / numberInterval) * numberInterval);
                    },
                };
            }
        }
        const ticks = settings.rorTicksC?.map((value) => Number(toDisplayRoR(value, temperatureUnit).toFixed(6)));
        const customValues = ticks?.length ? ticks : undefined;
        rorAxis.axisTick = { ...rorAxis.axisTick, customValues, show: Boolean(customValues) };
        rorAxis.axisLabel = { ...rorAxis.axisLabel, customValues, hideOverlap: true, verticalAlign: 'middle' };
        if (customValues) {
            rorAxis.axisLabel.formatter = formatTick;
        } else if (numberInterval > 0) {
            const step = numberInterval;
            rorAxis.axisLabel = {
                ...rorAxis.axisLabel,
                customValues: ticksFromInterval(Number(rorAxis.min), Number(rorAxis.max), step),
                hideOverlap: true,
                verticalAlign: 'middle',
                formatter: (value: number) => (matchesTick(value, step) ? formatTick(value) : ''),
            };
        }
    }
    for (const axis of Array.isArray(axes.xAxis) ? axes.xAxis : []) {
        if (axis.type === 'value' && settings.timeTickIntervalSec > 0) axis.interval = settings.timeTickIntervalSec;
        const minor = settings.timeMinorTickIntervalSec;
        if (axis.type === 'value' && minor != null) {
            const subdivisions = Number(axis.interval) / minor;
            axis.minorTick = {
                ...axis.minorTick,
                splitNumber:
                    Number.isInteger(subdivisions) && subdivisions >= 2 && subdivisions <= 100
                        ? subdivisions
                        : AXIS_MINOR_SPLIT_NUMBER,
            };
        }
        axis.axisLabel = { ...axis.axisLabel, hideOverlap: true };
    }
    const temperatureAxis = (Array.isArray(axes.yAxis) ? axes.yAxis : []).find(
        (axis) => axis.gridIndex === 0 && axis.position !== 'right',
    );
    if (temperatureAxis?.type !== 'value') return;
    temperatureAxis.splitLine = { ...temperatureAxis.splitLine, show: true };
    if (gridInterval > 0) {
        temperatureAxis.interval = gridInterval;
        temperatureAxis.minInterval = gridInterval;
        temperatureAxis.maxInterval = gridInterval;
    }
    const ticks = settings.tempTicksC?.map((value) => toDisplayTemp(value, temperatureUnit));
    const customValues = ticks?.length
        ? ticks
        : ticksFromInterval(Number(temperatureAxis.min), Number(temperatureAxis.max), settings.tempLabelInterval);
    temperatureAxis.axisTick = { ...temperatureAxis.axisTick, customValues: ticks?.length ? ticks : undefined };
    temperatureAxis.axisLabel = {
        ...temperatureAxis.axisLabel,
        customValues,
        hideOverlap: true,
        verticalAlign: 'middle',
        formatter: (value: number) =>
            ticks?.length || matchesTick(value, settings.tempLabelInterval) ? formatTick(value) : '',
    };
};

export const applyReportAxes = (
    axes: Pick<EChartsOption, 'xAxis' | 'yAxis'>,
    colors: ResolvedChartColors,
    durationSec: number,
    temperatureUnit: TemperatureUnit,
    tempIntervalOverride = 0,
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
        if (axis.type === 'value') {
            axis.interval = axis.position === 'right' && axis.gridIndex === 0 ? (temperatureUnit === 'F' ? 10 : 5) : 50;
            if (axis.gridIndex === 0 && axis.position !== 'right') {
                const span = Number(axis.max) - Number(axis.min);
                axis.interval = reportTempInterval(span, tempIntervalOverride);
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

export interface DualGridAxesParams {
    leftMargin: number;
    rightMargin: number;
    topMargin: number;
    controlChartHeightPct: number;
    mergeControlChart?: boolean;
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
        mergeControlChart = false,
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
        {
            left: leftMargin,
            right: rightMargin,
            top: topMargin,
            ...(mergeControlChart ? { bottom: CONTROL_GRID_BOTTOM } : { height: tempGridHeight }),
        },
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
            gridIndex: mergeControlChart ? 0 : 1,
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
    ] satisfies EChartsOption['xAxis'];

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
            splitLine: { show: false, lineStyle: { color: colors.gridLine, width: 0.5 } },
            min: rorYMin,
            max: rorYMax,
            interval: 20,
        },
        {
            gridIndex: mergeControlChart ? 0 : 1,
            type: 'value',
            nameLocation: 'middle',
            nameGap: Y_AXIS_NAME_GAP,
            nameTextStyle: axisNameStyle,
            position: 'left',
            axisLine: { onZero: false },
            axisTick: { show: false },
            axisLabel: { show: false },
            axisPointer: mergeControlChart ? yAxisPointerOff : yAxisPointer,
            splitLine: { show: !mergeControlChart, lineStyle: { color: colors.gridLine } },
            min: controlYMin,
            max: controlYMax,
        },
        {
            gridIndex: mergeControlChart ? 0 : 1,
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

    return {
        grid: mergeControlChart ? [grid[0]] : grid,
        xAxis: mergeControlChart ? [{ ...xAxis[1], axisLine: { onZero: false } }] : xAxis,
        yAxis,
    };
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
            axisLine: { onZero: false },
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
            splitLine: { show: false, lineStyle: { color: colors.gridLine } },
            min: rorYMin,
            max: rorYMax,
            interval: 20,
        },
    ] as EChartsOption['yAxis'];

    return { grid, xAxis, yAxis };
};
