import {
    getResolvedChartColors,
    getResolvedEventColor,
    ROR_Y_MAX,
    ROR_Y_MIN,
    TEMP_Y_INTERVAL,
} from '@features/active-roast/lib/chart-config';
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
import { getSmoothConfig, lineSeriesBase } from './series';

export type CompareChartSeries = {
    id: string;
    label: string;
    /** raw color or CSS var(--…) — resolved here for canvas */
    color: string;
    points: { t: number; bt: number; et: number | null; ror: number | null }[];
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
    xView?: { start: number; end: number } | null,
): EChartsOption => {
    const colors = getResolvedChartColors();
    const { axisLabelStyle, axisNameStyle, rightYAxisLabel } = buildAxisStyles(colors);
    const crossLineStyle = buildCrossLineStyle(colors);
    const { leftMargin, rightMargin, topMargin } = computeGridMargins(showRoR);

    const allBt = active.flatMap((s) => s.points.map((p) => p.bt)).filter(Number.isFinite);
    const tempYMin = allBt.length
        ? Math.min(100, Math.floor((Math.min(...allBt) - 10) / TEMP_Y_INTERVAL) * TEMP_Y_INTERVAL)
        : 100;
    const tempYMax = allBt.length
        ? Math.max(220, Math.ceil((Math.max(...allBt) + 10) / TEMP_Y_INTERVAL) * TEMP_Y_INTERVAL)
        : 250;

    const { grid, xAxis, yAxis } = buildSingleGridLayout({
        leftMargin,
        rightMargin,
        topMargin,
        xMin: xView?.start ?? 0,
        xMax: xView?.end ?? compareChartXMax(active),
        tempYMin,
        tempYMax,
        rorYMin: ROR_Y_MIN,
        rorYMax: ROR_Y_MAX,
        colors,
        axisLabelStyle,
        axisNameStyle,
        rightYAxisLabel,
        xAxisPointer: buildXAxisPointer(crossLineStyle),
        yAxisPointer: buildYAxisPointer(crossLineStyle),
    });
    // modal chart: no phase-bar strip below the plot, so reclaim the tall bottom margin
    (grid as { bottom?: number }[])[0].bottom = 30;

    const resolved = new Map(active.map((s) => [s.id, resolveCssColor(s.color)]));
    const series: object[] = [];

    for (const s of active) {
        const color = resolved.get(s.id) as string;
        series.push({
            name: `bt|${s.id}`,
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 0,
            z: 2,
            data: s.points.map((p) => [p.t, p.bt]),
            lineStyle: { color, width: 2 },
            itemStyle: { color },
            ...lineSeriesBase,
            ...getSmoothConfig(0.4),
            markPoint:
                s.markers && s.markers.length > 0
                    ? {
                          silent: true,
                          animation: false,
                          symbol: 'circle',
                          symbolSize: 6,
                          label: { show: false },
                          data: s.markers
                              .map((m) => {
                                  const nearest = s.points.reduce(
                                      (best, p) =>
                                          Math.abs(p.t - m.timeSec) < Math.abs(best.t - m.timeSec) ? p : best,
                                      s.points[0],
                                  );
                                  if (!nearest) return null;
                                  return {
                                      coord: [nearest.t, nearest.bt],
                                      itemStyle: {
                                          color: getResolvedEventColor(m.event),
                                          borderColor: colors.tooltipBg,
                                          borderWidth: 1,
                                      },
                                  };
                              })
                              .filter(Boolean),
                      }
                    : undefined,
        });

        if (showRoR) {
            series.push({
                name: `ror|${s.id}`,
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 1,
                z: 1,
                data: s.points
                    .filter((p) => p.ror != null && Number.isFinite(p.ror))
                    .map((p) => [p.t, p.ror as number]),
                lineStyle: { color, width: 1.2, opacity: 0.6 },
                itemStyle: { color },
                ...lineSeriesBase,
                ...getSmoothConfig(0.25),
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
        const rows = new Map<string, { bt?: number; ror?: number }>();
        for (const p of list) {
            const [kind, id] = (p.seriesName ?? '').split('|');
            const v = Array.isArray(p.value) ? p.value[1] : p.value;
            if (id == null || v == null || !Number.isFinite(v)) continue;
            const row = rows.get(id) ?? {};
            if (kind === 'bt') row.bt = v;
            else if (kind === 'ror') row.ror = v;
            rows.set(id, row);
        }
        let html = `<div style="font-weight:500;color:${colors.tooltipTimeColor};margin-bottom:6px;font-family:monospace">${fmtSec(Number(t))}</div>`;
        for (const s of active) {
            const row = rows.get(s.id);
            if (row?.bt == null) continue;
            html += `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">
                <span style="width:8px;height:8px;border-radius:2px;background:${resolved.get(s.id)}"></span>
                <span style="color:${colors.tooltipTimeColor};max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.label)}</span>
                <span style="font-weight:600;font-variant-numeric:tabular-nums">${row.bt.toFixed(1)}°C</span>
                ${row.ror != null ? `<span style="color:${colors.tooltipTimeColor};font-variant-numeric:tabular-nums">${row.ror.toFixed(1)}°/min</span>` : ''}
            </div>`;
        }
        return html;
    };

    return {
        backgroundColor: 'transparent',
        animation: false,
        grid,
        xAxis,
        yAxis: showRoR ? yAxis : ([(yAxis as object[])[0]] as EChartsOption['yAxis']),
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
        series: series as EChartsOption['series'],
    };
};
