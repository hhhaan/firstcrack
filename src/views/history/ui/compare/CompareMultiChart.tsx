import { ROR_Y_MAX, ROR_Y_MIN } from '@features/active-roast/lib/chart-config';
import { formatElapsed } from '@shared/lib/format';
import { useThemeStore } from '@shared/store/theme';
import { resolveColor } from '@shared/ui/Sparkline';
import * as echarts from 'echarts';
import { useEffect, useMemo, useRef } from 'react';

export type CompareSeries = {
    id: string;
    label: string;
    color: string;
    points: { t: number; bt: number; et: number | null; ror: number | null }[];
    markers?: { timeSec: number; event: string }[];
    visible?: boolean;
};

interface CompareMultiChartProps {
    series: CompareSeries[];
    height?: number;
    showRoR?: boolean;
}

const timeLabel = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return s === 0 ? `${m}:00` : `${m}:${String(s).padStart(2, '0')}`;
};

export const CompareMultiChart = ({ series, height = 320, showRoR = true }: CompareMultiChartProps) => {
    const elRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

    const active = useMemo(() => series.filter((s) => s.visible !== false && s.points.length > 0), [series]);

    const fingerprint = useMemo(
        () =>
            `${active
                .map((s) => {
                    const last = s.points[s.points.length - 1];
                    return `${s.id}:${s.points.length}:${last?.t ?? 0}:${last?.bt ?? 0}:${s.color}`;
                })
                .join('|')}|ror:${showRoR}|${resolvedTheme}`,
        [active, showRoR, resolvedTheme],
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: fingerprint covers series content
    useEffect(() => {
        const el = elRef.current;
        if (!el) return;

        const chart = chartRef.current ?? echarts.init(el);
        chartRef.current = chart;

        const cs = getComputedStyle(document.documentElement);
        const axisLabel = cs.getPropertyValue('--color-chart-axis-label').trim() || '#666';
        const gridStroke = cs.getPropertyValue('--color-chart-grid').trim() || 'rgba(0,0,0,0.08)';
        const tooltipBg = cs.getPropertyValue('--color-chart-tooltip-bg').trim() || '#fff';
        const tooltipBorder = cs.getPropertyValue('--color-chart-tooltip-border').trim() || 'rgba(0,0,0,0.08)';
        const textPrimary = cs.getPropertyValue('--color-primary').trim() || '#171717';
        const textMuted = cs.getPropertyValue('--color-muted').trim() || '#9ca3af';

        const maxT = Math.max(60, ...active.flatMap((s) => s.points.map((p) => p.t)));
        const allBt = active.flatMap((s) => s.points.map((p) => p.bt)).filter(Number.isFinite);
        const tempMin = allBt.length ? Math.min(100, Math.floor((Math.min(...allBt) - 10) / 10) * 10) : 100;
        const tempMax = allBt.length ? Math.max(220, Math.ceil((Math.max(...allBt) + 10) / 10) * 10) : 250;

        const echartsSeries: echarts.SeriesOption[] = [];

        for (const s of active) {
            const color = resolveColor(s.color);
            echartsSeries.push({
                name: `${s.label} BT`,
                type: 'line',
                showSymbol: false,
                symbol: 'circle',
                symbolSize: 6,
                sampling: 'lttb',
                lineStyle: { width: 2, color },
                itemStyle: { color },
                data: s.points.map((p) => [p.t, p.bt]),
                markPoint:
                    s.markers && s.markers.length > 0
                        ? {
                              symbol: 'circle',
                              symbolSize: 7,
                              itemStyle: {
                                  color: 'transparent',
                                  borderColor: color,
                                  borderWidth: 1.5,
                              },
                              label: { show: false },
                              data: s.markers
                                  .map((m) => {
                                      const nearest = s.points.reduce(
                                          (best, p) =>
                                              Math.abs(p.t - m.timeSec) < Math.abs(best.t - m.timeSec) ? p : best,
                                          s.points[0],
                                      );
                                      if (!nearest) return null;
                                      return { coord: [nearest.t, nearest.bt], name: m.event };
                                  })
                                  .filter(Boolean) as { coord: number[]; name: string }[],
                          }
                        : undefined,
            });

            if (showRoR) {
                echartsSeries.push({
                    name: `${s.label} RoR`,
                    type: 'line',
                    yAxisIndex: 1,
                    showSymbol: false,
                    sampling: 'lttb',
                    lineStyle: { width: 1.25, color, opacity: 0.72, type: 'solid' },
                    itemStyle: { color },
                    data: s.points
                        .filter((p) => p.ror != null && Number.isFinite(p.ror))
                        .map((p) => [p.t, p.ror as number]),
                });
            }
        }

        chart.setOption(
            {
                animation: false,
                grid: {
                    left: 44,
                    right: showRoR ? 40 : 16,
                    top: 16,
                    bottom: 28,
                },
                tooltip: {
                    trigger: 'axis',
                    axisPointer: { type: 'line', lineStyle: { color: textMuted, width: 1, type: 'dashed' } },
                    backgroundColor: tooltipBg,
                    borderColor: tooltipBorder,
                    borderWidth: 1,
                    textStyle: { color: textPrimary, fontSize: 12 },
                    formatter: (params: unknown) => {
                        const list = Array.isArray(params) ? params : [params];
                        if (list.length === 0) return '';
                        const t = (list[0] as { axisValue?: number }).axisValue;
                        if (t == null || !Number.isFinite(t)) return '';
                        let html = `<div style="font-weight:500;color:${textMuted};margin-bottom:6px">${formatElapsed(Number(t))}</div>`;
                        for (const raw of list) {
                            const p = raw as {
                                seriesName?: string;
                                value?: number[] | number;
                                color?: string;
                            };
                            const val = Array.isArray(p.value) ? p.value[1] : p.value;
                            if (val == null || !Number.isFinite(val)) continue;
                            const isRor = (p.seriesName ?? '').endsWith(' RoR');
                            html += `<div style="display:flex;align-items:center;gap:6px;margin-top:2px">
                                <span style="width:8px;height:8px;border-radius:2px;background:${p.color}"></span>
                                <span style="color:${textMuted}">${p.seriesName}</span>
                                <span style="font-weight:600;font-variant-numeric:tabular-nums">${Number(val).toFixed(1)}${isRor ? '°/min' : '°C'}</span>
                            </div>`;
                        }
                        return html;
                    },
                },
                xAxis: {
                    type: 'value',
                    min: 0,
                    max: Math.ceil(maxT / 30) * 30,
                    axisLabel: {
                        color: axisLabel,
                        fontSize: 11,
                        fontFamily: 'monospace',
                        formatter: (v: number) => timeLabel(v),
                    },
                    axisLine: { show: false },
                    axisTick: { show: false },
                    splitLine: { lineStyle: { color: gridStroke, width: 1 } },
                },
                yAxis: [
                    {
                        type: 'value',
                        min: tempMin,
                        max: tempMax,
                        axisLabel: {
                            color: axisLabel,
                            fontSize: 11,
                            fontFamily: 'monospace',
                            formatter: (v: number) => `${v}`,
                        },
                        axisLine: { show: false },
                        axisTick: { show: false },
                        splitLine: { lineStyle: { color: gridStroke, width: 1 } },
                    },
                    {
                        type: 'value',
                        show: showRoR,
                        min: ROR_Y_MIN,
                        max: ROR_Y_MAX,
                        axisLabel: {
                            color: axisLabel,
                            fontSize: 11,
                            fontFamily: 'monospace',
                        },
                        axisLine: { show: false },
                        axisTick: { show: false },
                        splitLine: { show: false },
                    },
                ],
                series: echartsSeries,
            },
            { notMerge: true },
        );

        const ro = new ResizeObserver(() => chart.resize());
        ro.observe(el);

        return () => {
            ro.disconnect();
        };
    }, [fingerprint, active, showRoR]);

    useEffect(() => {
        return () => {
            chartRef.current?.dispose();
            chartRef.current = null;
        };
    }, []);

    return <div ref={elRef} className="w-full" style={{ height }} />;
};
