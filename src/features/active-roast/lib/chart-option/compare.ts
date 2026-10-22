import {
    CHART_GRID_LEFT,
    getResolvedChartColors,
    ROR_Y_MAX,
    ROR_Y_MIN,
    TEMP_Y_INTERVAL,
} from '@features/active-roast/lib/chart-config';
import {
    type CurveStyles,
    canvasCurveTokens,
    DEFAULT_CURVE_STYLES,
    resolveCurveStyles,
} from '@features/active-roast/lib/curve-style';
import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { COMPARE_COLORS } from '@shared/lib/compare-style';
import type { EChartsOption } from 'echarts';
import {
    buildAxisStyles,
    buildCrossLineStyle,
    buildSingleGridLayout,
    buildTooltipCrossPointer,
    buildXAxisPointer,
    buildYAxisPointer,
    computeGridMargins,
    fmtSec,
    formatTempYLabel,
} from './axes';
import {
    type CompareChannel,
    type ComparePoint,
    compareChannels,
    compareChannelValue,
    compareCurveStyle,
    compareOtherUnits,
} from './compare-channels';
import { lineSeriesBase } from './series';

export type CompareChartSeries = {
    id: string;
    label: string;
    batchIndex: number;
    /** Profile batch number, shown at the end of the curve. Falls back to the compare slot. */
    batchLabel?: string;
    points: ComparePoint[];
    markers?: { timeSec: number; event: string }[];
    visible?: boolean;
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const COMPARE_COLOR_FALLBACK = ['#0091cb', '#009d4c', '#e2b000', '#6a6bd6', '#00a36d'] as const;

/** One color per batch. Canvas cannot read `var()`, so resolve the token here. */
export const compareBatchColor = (batchIndex: number): string => {
    const count = COMPARE_COLORS.length;
    const index = ((batchIndex % count) + count) % count;
    const token = COMPARE_COLORS[index].slice(4, -1);
    const root = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
    return root?.getPropertyValue(token).trim() || COMPARE_COLOR_FALLBACK[index];
};

/** 전체 X축 범위 (초) — useChartZoom의 MAX_TIME과 옵션 xMax의 공용 SSoT */
export const compareChartXMax = (active: CompareChartSeries[]): number =>
    Math.ceil(Math.max(60, ...active.flatMap((s) => s.points.map((p) => p.t))) / 30) * 30;

const compareSingleAxisChannel = (channels: CompareChannel[]): CompareChannel | undefined => {
    const first = channels.length > 0 ? channels[0] : undefined;
    return first && channels.every((channel) => channel.kind === first.kind && channel.unit === first.unit)
        ? first
        : undefined;
};

const compareControlOnly = (channels: CompareChannel[]): boolean =>
    channels.length > 0 && channels.every((channel) => channel.kind === 'other');

/** Grid lines every 10. Percent keeps a 0–100 scale. Drum starts at 0 so the 10-step stays visible. */
const controlAxisTicks = (unit: string, samples: number[]): { min: number; max: number; interval: number } => {
    if (unit === '%') return { min: 0, max: 100, interval: 10 };
    const finite = samples.filter((value) => Number.isFinite(value));
    const hi = finite.length > 0 ? Math.max(...finite) : 50;
    return { min: 0, max: Math.max(50, Math.ceil(hi / 10) * 10), interval: 10 };
};

const controlAxisLabel = (value: number, unit: string) => {
    const n = Math.round(value);
    const step = unit === '%' ? 50 : 10;
    return n % step === 0 ? String(n) : '';
};

/** Every compare plot uses this box so temperature, phase, and control charts share one time axis. */
export const COMPARE_GRID_LEFT = CHART_GRID_LEFT;
export const COMPARE_GRID_RIGHT = 56;

/** Shared with zoom and the aligned phase/control plots. */
export const compareChartRightMargin = (_channels: CompareChannel[]): number => COMPARE_GRID_RIGHT;

/** Multi-session overlay chart (History compare) — same visual grammar as the live roast chart. */
export const buildCompareChartOption = (
    active: CompareChartSeries[],
    {
        xView,
        temperatureUnit = 'C',
        channelKeys,
        focusedSessionId = null,
        rightMargin: sharedRightMargin,
        curveStyles = DEFAULT_CURVE_STYLES,
        showEndLabels = false,
        hideAxisName = false,
    }: {
        xView: { start: number; end: number };
        temperatureUnit?: TemperatureUnit;
        channelKeys?: string[];
        focusedSessionId?: string | null;
        rightMargin?: number;
        curveStyles?: CurveStyles;
        showEndLabels?: boolean;
        /** Unit is already in the chart title, so the axis name is omitted. */
        hideAxisName?: boolean;
    },
): EChartsOption => {
    const colors = getResolvedChartColors();
    const curves = resolveCurveStyles(curveStyles, canvasCurveTokens(colors));
    const { axisLabelStyle, axisNameStyle, rightYAxisLabel } = buildAxisStyles(colors);
    const crossLineStyle = buildCrossLineStyle(colors);
    const selectedKeys = channelKeys ? new Set(channelKeys) : null;
    const channels = compareChannels(active, temperatureUnit).filter(
        (channel) => selectedKeys == null || selectedKeys.has(channel.key),
    );
    const hasRoR = channels.some((channel) => channel.kind === 'ror');
    const singleAxisChannel = compareSingleAxisChannel(channels);
    const controlOnly = !singleAxisChannel && compareControlOnly(channels);
    const otherUnits = compareOtherUnits(channels);
    const margins = computeGridMargins(hasRoR);
    const leftMargin = margins.leftMargin;
    const rightMargin = sharedRightMargin ?? compareChartRightMargin(channels);
    const topMargin = margins.topMargin;
    const plotSeries = active;
    const allBt = plotSeries.flatMap((s) =>
        s.points.flatMap((point) =>
            channels
                .filter((channel) => channel.kind === 'temperature')
                .map((channel) => compareChannelValue(point, channel, temperatureUnit))
                .filter((value): value is number => value !== null),
        ),
    );
    const defaultMin = toDisplayTemp(100, temperatureUnit);
    const allRoR = plotSeries.flatMap((s) =>
        s.points.flatMap((point) =>
            channels
                .filter((channel) => channel.kind === 'ror')
                .map((channel) => compareChannelValue(point, channel, temperatureUnit))
                .filter((value): value is number => value !== null),
        ),
    );
    const tempYMin = allBt.length
        ? Math.floor((Math.min(...allBt) - 10) / TEMP_Y_INTERVAL) * TEMP_Y_INTERVAL
        : defaultMin;
    const tempYMax = allBt.length
        ? Math.ceil((Math.max(...allBt) + 10) / TEMP_Y_INTERVAL) * TEMP_Y_INTERVAL
        : toDisplayTemp(250, temperatureUnit);

    const { grid, xAxis, yAxis } = buildSingleGridLayout({
        leftMargin,
        rightMargin,
        topMargin,
        xMin: xView.start,
        xMax: xView.end,
        tempYMin,
        tempYMax,
        rorYMin: toDisplayRoR(ROR_Y_MIN, temperatureUnit),
        rorYMax: Math.max(
            toDisplayRoR(ROR_Y_MAX, temperatureUnit),
            ...allRoR.filter((value) => value >= toDisplayRoR(ROR_Y_MIN, temperatureUnit)),
        ),
        colors,
        axisLabelStyle,
        axisNameStyle,
        rightYAxisLabel,
        xAxisPointer: buildXAxisPointer(crossLineStyle),
        yAxisPointer: buildYAxisPointer(crossLineStyle),
    });
    const gridBox = (grid as { left: number; right: number; bottom?: number; containLabel?: boolean }[])[0];
    gridBox.left = COMPARE_GRID_LEFT;
    gridBox.right = rightMargin;
    gridBox.bottom = 28;
    gridBox.containLabel = false;

    const baseAxes = Array.isArray(yAxis) ? yAxis : [];
    const plotAxes = baseAxes.slice(0, hasRoR ? 2 : 1);
    if (singleAxisChannel) {
        const candidate = baseAxes.find((axis) =>
            singleAxisChannel.kind === 'ror' ? axis.position === 'right' : axis.position !== 'right',
        );
        const base = singleAxisChannel.kind === 'temperature' && candidate?.type === 'value' ? candidate : {};
        const controlTicks = hideAxisName
            ? controlAxisTicks(
                  singleAxisChannel.unit,
                  plotSeries.flatMap((session) =>
                      session.points.map(
                          (point) => compareChannelValue(point, singleAxisChannel, temperatureUnit) ?? NaN,
                      ),
                  ),
              )
            : null;
        plotAxes.splice(0, plotAxes.length, {
            ...base,
            type: 'value',
            position: 'left',
            ...(hideAxisName
                ? {}
                : {
                      name: singleAxisChannel.unit,
                      nameLocation: 'end' as const,
                      nameGap: 14,
                      nameTextStyle: { ...axisNameStyle, fontSize: 12 },
                  }),
            scale: controlTicks == null,
            axisLabel: {
                ...axisLabelStyle,
                hideOverlap: true,
                ...(controlTicks
                    ? { formatter: (value: number) => controlAxisLabel(value, singleAxisChannel.unit) }
                    : {}),
            },
            axisLine: { show: false },
            axisTick: { show: false },
            axisPointer: buildYAxisPointer(crossLineStyle),
            splitLine: { show: true, lineStyle: { color: colors.gridLine } },
            splitNumber: controlTicks == null ? 5 : 2,
            interval:
                controlTicks?.interval ?? (singleAxisChannel.kind === 'temperature' ? TEMP_Y_INTERVAL : undefined),
            ...(singleAxisChannel.kind === 'temperature'
                ? {
                      min: Math.floor(tempYMin / TEMP_Y_INTERVAL) * TEMP_Y_INTERVAL,
                      max: Math.ceil(tempYMax / TEMP_Y_INTERVAL) * TEMP_Y_INTERVAL,
                  }
                : {}),
            ...(singleAxisChannel.source === 'heaterSet' && singleAxisChannel.unit === '%' ? { min: 0, max: 100 } : {}),
            ...(controlTicks ?? {}),
        });
    }
    for (const axis of Array.isArray(xAxis) ? xAxis : []) {
        axis.minorSplitLine = { show: false };
        axis.axisLabel = { ...axis.axisLabel, fontSize: 12, hideOverlap: true };
    }
    if (controlOnly) {
        plotAxes.splice(0, plotAxes.length);
        otherUnits.forEach((unit, index) => {
            plotAxes.push({
                type: 'value',
                position: index === 0 ? 'left' : 'right',
                offset: index <= 1 ? 0 : (index - 1) * 48,
                ...(hideAxisName
                    ? {}
                    : {
                          name: unit,
                          nameLocation: 'end' as const,
                          nameGap: 14,
                          nameTextStyle: { ...axisNameStyle, fontSize: 12 },
                      }),
                min: unit === '%' ? 0 : undefined,
                max: unit === '%' ? 100 : undefined,
                scale: unit !== '%',
                axisLabel: index === 0 ? axisLabelStyle : rightYAxisLabel,
                axisLine: { show: false },
                axisTick: { show: false },
                splitLine: { show: index === 0, lineStyle: { color: colors.gridLine } },
                splitNumber: 4,
                axisPointer: buildYAxisPointer(crossLineStyle),
            });
        });
    }
    for (const [index, unit] of (singleAxisChannel || controlOnly ? [] : otherUnits).entries()) {
        plotAxes.push({
            type: 'value',
            position: 'right',
            offset: (hasRoR ? 48 : 0) + index * 48,
            name: unit,
            axisLine: { onZero: false },
            scale: true,
            axisLabel: rightYAxisLabel,
            splitNumber: 4,
            splitLine: { show: false },
            axisPointer: buildYAxisPointer(crossLineStyle),
        });
    }
    for (const axis of plotAxes) {
        axis.axisLabel = { ...axis.axisLabel, fontSize: 12 };
    }
    if (!hideAxisName && channels.some((channel) => channel.kind === 'temperature')) {
        const tempAxis = plotAxes.find((axis) => axis.position !== 'right');
        if (tempAxis?.type === 'value') {
            tempAxis.min = Math.floor(tempYMin / TEMP_Y_INTERVAL) * TEMP_Y_INTERVAL;
            tempAxis.max = Math.ceil(tempYMax / TEMP_Y_INTERVAL) * TEMP_Y_INTERVAL;
            tempAxis.interval = TEMP_Y_INTERVAL;
            tempAxis.scale = false;
            tempAxis.splitLine = { show: true, lineStyle: { color: colors.gridLine } };
            tempAxis.axisLabel = { ...axisLabelStyle, fontSize: 12, formatter: formatTempYLabel, hideOverlap: true };
        }
    }
    const series: object[] = [];
    const legend = new Map<string, { session: CompareChartSeries; channel: CompareChannel }>();

    for (const s of plotSeries) {
        const dimmed = focusedSessionId !== null && focusedSessionId !== s.id;
        const color = compareBatchColor(s.batchIndex);
        for (const channel of channels) {
            const curve = compareCurveStyle(channel, curves);
            const data = s.points.map((p) => [p.t, compareChannelValue(p, channel, temperatureUnit)]);
            if (!data.some((point) => point[1] !== null)) continue;
            const name = `${channel.key}|${s.id}`;
            legend.set(name, { session: s, channel });
            const axisIndex = controlOnly
                ? Math.max(0, otherUnits.indexOf(channel.unit))
                : channel.kind === 'temperature'
                  ? 0
                  : channel.kind === 'ror'
                    ? 1
                    : (hasRoR ? 2 : 1) + otherUnits.indexOf(channel.unit);
            series.push({
                name,
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: singleAxisChannel ? 0 : axisIndex,
                z: focusedSessionId === s.id ? 5 : channel.kind === 'ror' ? 1 : 2,
                data,
                step: channel.source === 'heaterSet' ? 'end' : false,
                lineStyle: {
                    color,
                    width: focusedSessionId === s.id ? Math.max(4, curve.width + 1) : Math.max(2, curve.width),
                    type: 'solid',
                    opacity: dimmed ? 0.15 : 1,
                },
                ...lineSeriesBase,
                showSymbol: false,
                symbol: 'none',
                endLabel: {
                    show:
                        showEndLabels && (channel.source === 'bt' || (controlOnly && channels[0]?.key === channel.key)),
                    formatter: s.batchLabel ?? String(s.batchIndex + 1).padStart(2, '0'),
                    color,
                    fontSize: 12,
                    fontFamily: 'monospace',
                    opacity: dimmed ? 0.15 : 1,
                },
                labelLayout: { moveOverlap: 'shiftY' },
            });
        }
    }

    const formatter = (params: unknown) => {
        const list = (Array.isArray(params) ? params : [params]) as {
            seriesName?: string;
            axisValue?: number;
            value?: number[] | number;
        }[];
        const t = list[0]?.axisValue;
        if (t == null || !Number.isFinite(t)) return '';
        let html = `<div style="font-weight:500;color:${colors.axisLabel};margin-bottom:8px;font-family:monospace">${fmtSec(Number(t))}</div>`;
        for (const p of list) {
            const item = legend.get(p.seriesName ?? '');
            const value = Array.isArray(p.value) ? p.value[1] : p.value;
            if (!item || value == null || !Number.isFinite(value)) continue;
            html += `<div style="display:flex;align-items:center;gap:8px;margin-top:6px">
                <span style="width:16px;height:3px;border-radius:2px;background:${compareBatchColor(item.session.batchIndex)}"></span>
                <span style="color:${colors.markerLabelColor}">${escapeHtml(item.session.label)} · ${escapeHtml(item.channel.label)}</span>
                <span style="font-weight:600">${value.toFixed(1)}${escapeHtml(item.channel.unit)}</span>
            </div>`;
        }
        return html;
    };

    return {
        backgroundColor: 'transparent',
        animation: false,
        grid,
        xAxis,
        yAxis: plotAxes,
        tooltip: {
            trigger: 'axis',
            backgroundColor: colors.tooltipBg,
            borderWidth: 1,
            borderColor: colors.tooltipBorder,
            extraCssText: 'box-shadow: none;',
            textStyle: { fontSize: 14, color: colors.markerLabelColor },
            axisPointer: buildTooltipCrossPointer(crossLineStyle),
            formatter,
        },
        dataZoom: [],
        series,
    };
};
