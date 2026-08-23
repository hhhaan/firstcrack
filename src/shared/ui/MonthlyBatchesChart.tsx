import { useThemeStore } from '@shared/store/theme';
import * as echarts from 'echarts';
import { useEffect, useMemo, useRef } from 'react';

interface MonthlyBatchesChartProps {
    data: { month: string; batches: number }[];
}

export const MonthlyBatchesChart = ({ data }: MonthlyBatchesChartProps) => {
    const elRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const lastSizeRef = useRef({ w: 0, h: 0 });
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

    useEffect(() => {
        const el = elRef.current;
        if (!el) return;
        const chart = echarts.init(el, undefined, { renderer: 'canvas', useDirtyRect: false });
        chartRef.current = chart;
        const ro = new ResizeObserver(() => {
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            if (w <= 0 || h <= 0) return;
            const last = lastSizeRef.current;
            if (last.w === w && last.h === h) return;
            lastSizeRef.current = { w, h };
            chart.resize();
        });
        ro.observe(el);
        return () => {
            ro.disconnect();
            chart.dispose();
            chartRef.current = null;
        };
    }, []);

    const option = useMemo((): echarts.EChartsOption => {
        const cs = getComputedStyle(document.documentElement);
        const colorPrimary =
            cs.getPropertyValue('--color-primary').trim() || (resolvedTheme === 'dark' ? '#e5e5e5' : '#171717');
        const colorMuted =
            cs.getPropertyValue('--color-muted').trim() || (resolvedTheme === 'dark' ? '#8a8580' : '#777169');
        const maxVal = Math.max(...data.map((d) => d.batches), 1);

        return {
            animation: false,
            grid: { left: 28, right: 8, top: 8, bottom: 28 },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'none' },
                backgroundColor: '#fff',
                borderWidth: 0,
                borderRadius: 10,
                padding: [6, 12],
                textStyle: { color: colorPrimary, fontSize: 13 },
                extraCssText: 'box-shadow: rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px;',
                formatter: (params) => {
                    const p = Array.isArray(params) ? params[0] : params;
                    if (!p) return '';
                    return `${p.name}: ${p.value} batches`;
                },
            },
            xAxis: {
                type: 'category',
                data: data.map((d) => d.month),
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { color: colorMuted, fontSize: 12 },
            },
            yAxis: {
                type: 'value',
                min: 0,
                max: maxVal,
                splitNumber: 3,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { color: colorMuted, fontSize: 11 },
                splitLine: { lineStyle: { color: 'rgba(0,0,0,0.05)', width: 1 } },
            },
            series: [
                {
                    type: 'bar',
                    data: data.map((d) => d.batches),
                    barMaxWidth: 20,
                    itemStyle: { color: colorPrimary, borderRadius: [4, 4, 0, 0] },
                },
            ],
        };
    }, [data, resolvedTheme]);

    useEffect(() => {
        chartRef.current?.setOption(option, true);
    }, [option]);

    return <div ref={elRef} className="w-full h-full" />;
};
