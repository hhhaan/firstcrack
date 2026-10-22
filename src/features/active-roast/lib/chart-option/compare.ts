import {
    getResolvedChartColors,
    getResolvedEventColor,
    ROR_Y_MAX,
    ROR_Y_MIN,
    TEMP_Y_INTERVAL,
    TEMP_Y_LABEL_INTERVAL,
} from '@features/active-roast/lib/chart-config';
import {
    type CurveStyles,
    canvasCurveTokens,
    DEFAULT_CURVE_STYLES,
    resolveCurveStyles,
} from '@features/active-roast/lib/curve-style';
import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { COMPARE_MARKERS } from '@shared/lib/compare-style';
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
} from './axes';
import {
    type CompareChannel,
    type ComparePoint,
    compareChannels,
    compareChannelValue,
    compareCurveStyle,
    compareExtraAxisWidth,
    compareOtherUnits,
} from './compare-channels';
import { lineSeriesBase } from './series';

export type CompareChartSeries = {
    id: string;
    label: string;
    batchIndex: number;
    points: ComparePoint[];
    markers?: { timeSec: number; event: string }[];
    visible?: boolean;
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 전체 X축 범위 (초) — useChartZoom의 MAX_TIME과 옵션 xMax의 공용 SSoT */
export const compareChartXMax = (active: CompareChartSeries[]): number =>
    Math.ceil(Math.max(60, ...active.flatMap((s) => s.points.map((p) => p.t))) / 30) * 30;

const compareSingleAxisChannel = (channels: CompareChannel[]): CompareChannel | undefined => {
    const first = channels.length > 0 ? channels[0] : undefined;
    return first && channels.every((channel) => channel.kind === first.kind && channel.unit === first.unit)
        ? first
        : undefined;
};

/** Shared with zoom and the aligned phase/control plots. */
export const compareChartRightMargin = (channels: CompareChannel[]): number =>
    compareSingleAxisChannel(channels)
        ? computeGridMargins(false).rightMargin + 24
        : computeGridMargins(channels.some((channel) => channel.kind === 'ror')).rightMargin +
          compareExtraAxisWidth(channels);

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
    }: {
        xView: { start: number; end: number };
        temperatureUnit?: TemperatureUnit;
        channelKeys?: string[];
        focusedSessionId?: string | null;
        rightMargin?: number;
        curveStyles?: CurveStyles;
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
        rorYMin: Math.min(toDisplayRoR(ROR_Y_MIN, temperatureUnit), ...allRoR),
        rorYMax: Math.max(toDisplayRoR(ROR_Y_MAX, temperatureUnit), ...allRoR),
        colors,
        axisLabelStyle,
        axisNameStyle,
        rightYAxisLabel,
        xAxisPointer: buildXAxisPointer(crossLineStyle),
        yAxisPointer: buildYAxisPointer(crossLineStyle),
    });
    (grid as { bottom?: number }[])[0].bottom = 30;

    const baseAxes = Array.isArray(yAxis) ? yAxis : [];
    const plotAxes = baseAxes.slice(0, hasRoR ? 2 : 1);
    if (singleAxisChannel) {
        const candidate = baseAxes.find((axis) =>
            singleAxisChannel.kind === 'ror' ? axis.position === 'right' : axis.position !== 'right',
        );
        const base = singleAxisChannel.kind === 'temperature' && candidate?.type === 'value' ? candidate : {};
        plotAxes.splice(0, plotAxes.length, {
            ...base,
            type: 'value',
            position: 'left',
            name: singleAxisChannel.unit,
            nameLocation: 'end',
            nameGap: 14,
            nameTextStyle: { ...axisNameStyle, fontSize: 12 },
            scale: true,
            axisLabel: axisLabelStyle,
            axisLine: { show: false },
            axisTick: { show: false },
            axisPointer: buildYAxisPointer(crossLineStyle),
            splitLine: { show: true, lineStyle: { color: colors.gridLine } },
            splitNumber: 5,
            interval: singleAxisChannel.kind === 'temperature' ? TEMP_Y_LABEL_INTERVAL : undefined,
            ...(singleAxisChannel.kind === 'temperature'
                ? {
                      min: Math.floor(tempYMin / TEMP_Y_LABEL_INTERVAL) * TEMP_Y_LABEL_INTERVAL,
                      max: Math.ceil(tempYMax / TEMP_Y_LABEL_INTERVAL) * TEMP_Y_LABEL_INTERVAL,
                  }
                : {}),
            ...(singleAxisChannel.source === 'heaterSet' && singleAxisChannel.unit === '%' ? { min: 0, max: 100 } : {}),
        });
    }
    for (const axis of Array.isArray(xAxis) ? xAxis : []) {
        axis.minorSplitLine = { show: false };
        axis.axisLabel = { ...axis.axisLabel, fontSize: 12, hideOverlap: true };
    }
    for (const [index, unit] of (singleAxisChannel ? [] : otherUnits).entries()) {
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
    const series: object[] = [];
    const legend = new Map<string, { session: CompareChartSeries; channel: CompareChannel }>();

    for (const s of plotSeries) {
        const dimmed = focusedSessionId !== null && focusedSessionId !== s.id;
        const visiblePoints = s.points.filter((point) => point.t >= xView.start && point.t <= xView.end).length;
        const markerInterval = Math.max(1, Math.ceil(visiblePoints / 6));
        for (const channel of channels) {
            const curve = compareCurveStyle(channel, curves);
            const color = curve.color;
            const data = s.points.map((p) => [p.t, compareChannelValue(p, channel, temperatureUnit)]);
            if (!data.some((point) => point[1] !== null)) continue;
            const name = `${channel.key}|${s.id}`;
            legend.set(name, { session: s, channel });
            const axisIndex =
                channel.kind === 'temperature'
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
                showSymbol: true,
                symbol: `path://${COMPARE_MARKERS[s.batchIndex % COMPARE_MARKERS.length]}`,
                symbolSize: (_value: unknown, params: { dataIndex: number }) =>
                    params.dataIndex % markerInterval === 0 ? 8 : 0,
                itemStyle: {
                    color: colors.tooltipBg,
                    borderColor: color,
                    borderWidth: 1.5,
                    opacity: dimmed ? 0.15 : 1,
                },
                endLabel: {
                    show: true,
                    formatter: String(s.batchIndex + 1).padStart(2, '0'),
                    color,
                    fontSize: 12,
                    fontFamily: 'monospace',
                    opacity: dimmed ? 0.15 : 1,
                },
                labelLayout: { moveOverlap: 'shiftY' },
                markPoint:
                    channel.source === 'bt' && s.markers?.length
                        ? {
                              silent: true,
                              animation: false,
                              symbol: 'circle',
                              symbolSize: 6,
                              label: { show: false },
                              data: s.markers.map((m) => {
                                  const nearest = s.points.reduce(
                                      (best, p) =>
                                          Math.abs(p.t - m.timeSec) < Math.abs(best.t - m.timeSec) ? p : best,
                                      s.points[0],
                                  );
                                  return {
                                      coord: [nearest.t, toDisplayTemp(nearest.bt, temperatureUnit)],
                                      itemStyle: {
                                          color: getResolvedEventColor(m.event),
                                          borderColor: colors.tooltipBg,
                                          borderWidth: 1,
                                      },
                                  };
                              }),
                          }
                        : undefined,
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
                <span style="width:16px;height:3px;border-radius:2px;background:${compareCurveStyle(item.channel, curves).color}"></span>
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
