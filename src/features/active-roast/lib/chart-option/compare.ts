import {
    getResolvedChartColors,
    getResolvedEventColor,
    ROR_Y_MAX,
    ROR_Y_MIN,
    TEMP_CURVE_WIDTH,
    TEMP_Y_INTERVAL,
} from '@features/active-roast/lib/chart-config';
import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
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
    compareExtraAxisWidth,
    compareOtherUnits,
} from './compare-channels';
import { lineSeriesBase } from './series';

export type CompareChartSeries = {
    id: string;
    label: string;
    /** raw color or CSS var(--…) — resolved here for canvas */
    color: string;
    points: ComparePoint[];
    markers?: { timeSec: number; event: string }[];
    visible?: boolean;
};

const resolveCssColor = (color: string): string => {
    if (!color.startsWith('var(')) return color;
    const name = color.slice(4, -1).trim();
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#171717';
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 전체 X축 범위 (초) — useChartZoom의 MAX_TIME과 옵션 xMax의 공용 SSoT */
export const compareChartXMax = (active: CompareChartSeries[]): number =>
    Math.ceil(Math.max(60, ...active.flatMap((s) => s.points.map((p) => p.t))) / 30) * 30;

/** Multi-session overlay chart (History compare) — same visual grammar as the live roast chart. */
export const buildCompareChartOption = (
    active: CompareChartSeries[],
    showRoR: boolean,
    xView: { start: number; end: number },
    temperatureUnit: TemperatureUnit = 'C',
    channelKeys?: string[],
): EChartsOption => {
    const colors = getResolvedChartColors();
    const { axisLabelStyle, axisNameStyle, rightYAxisLabel } = buildAxisStyles(colors);
    const crossLineStyle = buildCrossLineStyle(colors);
    const channels = compareChannels(active, temperatureUnit).filter(
        (channel) => (showRoR || channel.kind !== 'ror') && (channelKeys == null || channelKeys.includes(channel.key)),
    );
    const hasRoR = channels.some((channel) => channel.kind === 'ror');
    const otherUnits = compareOtherUnits(channels);
    const margins = computeGridMargins(hasRoR);
    const leftMargin = margins.leftMargin;
    const rightMargin = margins.rightMargin + compareExtraAxisWidth(channels);
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
    const defaultMax = toDisplayTemp(220, temperatureUnit);
    const allRoR = plotSeries.flatMap((s) =>
        s.points.flatMap((point) =>
            channels
                .filter((channel) => channel.kind === 'ror')
                .map((channel) => compareChannelValue(point, channel, temperatureUnit))
                .filter((value): value is number => value !== null),
        ),
    );
    const tempYMin = allBt.length
        ? Math.min(defaultMin, Math.floor((Math.min(...allBt) - 10) / TEMP_Y_INTERVAL) * TEMP_Y_INTERVAL)
        : defaultMin;
    const tempYMax = allBt.length
        ? Math.max(defaultMax, Math.ceil((Math.max(...allBt) + 10) / TEMP_Y_INTERVAL) * TEMP_Y_INTERVAL)
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
    // modal chart: no phase-bar strip below the plot, so reclaim the tall bottom margin
    (grid as { bottom?: number }[])[0].bottom = 30;

    const plotAxes = (yAxis as object[]).slice(0, hasRoR ? 2 : 1);
    for (const [index, unit] of otherUnits.entries()) {
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
    const resolved = new Map(plotSeries.map((s) => [s.id, resolveCssColor(s.color)]));
    const series: object[] = [];
    const legend = new Map<string, { session: CompareChartSeries; channel: CompareChannel }>();

    for (const s of plotSeries) {
        const color = resolved.get(s.id) as string;
        for (const channel of channels) {
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
                yAxisIndex: axisIndex,
                z: channel.kind === 'ror' ? 1 : 2,
                data,
                lineStyle: {
                    color,
                    width: TEMP_CURVE_WIDTH,
                    type:
                        channel.source === 'bt'
                            ? 'solid'
                            : channel.source === 'et'
                              ? 'dashed'
                              : channel.source === 'ror'
                                ? 'dotted'
                                : channel.source === 'rorEt'
                                  ? [5, 2, 1, 2]
                                  : [10, 3, 2, 3],
                    opacity: channel.kind === 'ror' ? 0.65 : 1,
                },
                itemStyle: { color },
                ...lineSeriesBase,
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
        let html = `<div style="font-weight:500;color:${colors.tooltipTimeColor};margin-bottom:6px;font-family:monospace">${fmtSec(Number(t))}</div>`;
        for (const p of list) {
            const item = legend.get(p.seriesName ?? '');
            const value = Array.isArray(p.value) ? p.value[1] : p.value;
            if (!item || value == null || !Number.isFinite(value)) continue;
            html += `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">
                <span style="width:8px;height:8px;border-radius:2px;background:${resolved.get(item.session.id)}"></span>
                <span style="color:${colors.tooltipTimeColor}">${escapeHtml(item.session.label)} · ${escapeHtml(item.channel.label)}</span>
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
            textStyle: { fontSize: 12 },
            axisPointer: buildTooltipCrossPointer(crossLineStyle),
            formatter,
        },
        dataZoom: [],
        series,
    };
};
