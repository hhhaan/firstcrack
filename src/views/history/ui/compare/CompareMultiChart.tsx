import { buildCompareChartOption, type CompareChartSeries } from '@features/active-roast/lib/chart-option';
import { useThemeStore } from '@shared/store/theme';
import * as echarts from 'echarts';
import { useEffect, useMemo, useRef } from 'react';

export type CompareSeries = CompareChartSeries;

interface CompareMultiChartProps {
    series: CompareSeries[];
    height?: number;
    showRoR?: boolean;
}

export const CompareMultiChart = ({ series, height = 320, showRoR = true }: CompareMultiChartProps) => {
    const elRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

    const active = useMemo(() => series.filter((s) => s.visible !== false && s.points.length > 0), [series]);

    // useQueries returns fresh array identities every render — fingerprint the
    // content so setOption only runs when the data actually changed.
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

    useEffect(() => {
        const el = elRef.current;
        if (!el) return;
        const chart = echarts.init(el, undefined, { renderer: 'canvas', useDirtyRect: false });
        chartRef.current = chart;

        const lastSize = { w: 0, h: 0 };
        const ro = new ResizeObserver(() => {
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            if (w <= 0 || h <= 0 || (lastSize.w === w && lastSize.h === h)) return;
            lastSize.w = w;
            lastSize.h = h;
            chart.resize();
        });
        ro.observe(el);

        return () => {
            ro.disconnect();
            chart.dispose();
            chartRef.current = null;
        };
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: fingerprint covers series content
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        chart.setOption(buildCompareChartOption(active, showRoR), { notMerge: true });
    }, [fingerprint]);

    return <div ref={elRef} className="w-full" style={{ height }} />;
};
