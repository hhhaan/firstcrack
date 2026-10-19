import { useThemeStore } from '@shared/store/theme';
import * as echarts from 'echarts';
import { useEffect, useMemo, useRef } from 'react';

interface MetricTrendChartProps {
    data: { label: string; value: number | null }[];
    label: string;
    formatValue?: (value: number) => string;
}

export const MetricTrendChart = ({ data, label, formatValue = String }: MetricTrendChartProps) => {
    const elRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const lastSizeRef = useRef({ width: 0, height: 0 });
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

    useEffect(() => {
        const el = elRef.current;
        if (!el) return;
        const chart = echarts.init(el, undefined, { renderer: 'canvas', useDirtyRect: false });
        chartRef.current = chart;
        const observer = new ResizeObserver(() => {
            const width = el.offsetWidth;
            const height = el.offsetHeight;
            if (width <= 0 || height <= 0) return;
            if (lastSizeRef.current.width === width && lastSizeRef.current.height === height) return;
            lastSizeRef.current = { width, height };
            chart.resize();
        });
        observer.observe(el);
        return () => {
            observer.disconnect();
            chart.dispose();
            chartRef.current = null;
        };
    }, []);

    const option = useMemo((): echarts.EChartsOption => {
        const style = getComputedStyle(document.documentElement);
        const color = (name: string) => style.getPropertyValue(name).trim();
        const colorMuted = color('--color-muted');
        const colorBorder = color('--color-border-subtle');
        const colorLine = color('--color-palette-blue');

        return {
            darkMode: resolvedTheme === 'dark',
            animation: false,
            grid: { left: 8, right: 8, top: 12, bottom: 24 },
            tooltip: {
                trigger: 'axis',
                renderMode: 'richText',
                confine: true,
                axisPointer: { type: 'line', lineStyle: { color: colorMuted, type: 'dashed' } },
                backgroundColor: color('--color-main-bg'),
                borderColor: colorBorder,
                borderWidth: 1,
                borderRadius: 8,
                padding: [6, 12],
                textStyle: { color: color('--color-primary'), fontSize: 12 },
                formatter: (params) => {
                    const point = Array.isArray(params) ? params[0] : params;
                    return `${point.name}: ${typeof point.value === 'number' ? formatValue(point.value) : '—'}`;
                },
            },
            xAxis: {
                type: 'category',
                data: data.map((point) => point.label),
                boundaryGap: false,
                axisLine: { show: true, lineStyle: { color: colorBorder } },
                axisTick: { show: false },
                axisLabel: { color: colorMuted, fontSize: 10, margin: 10, hideOverlap: true },
                splitLine: { show: true, lineStyle: { color: colorBorder, type: 'dashed' } },
            },
            yAxis: {
                type: 'value',
                min: 0,
                max: (extent) => Math.max(extent.max * 1.15, 1),
                axisLabel: { show: false },
                axisLine: { show: false },
                axisTick: { show: false },
                splitLine: { show: false },
            },
            series: [
                {
                    name: label,
                    type: 'line',
                    data: data.map((point) => point.value),
                    showSymbol: data.filter((point) => point.value != null).length === 1,
                    symbolSize: 5,
                    connectNulls: false,
                    lineStyle: { color: colorLine, width: 1.5 },
                    itemStyle: { color: colorLine },
                    emphasis: { scale: false },
                },
            ],
        };
    }, [data, label, formatValue, resolvedTheme]);

    useEffect(() => {
        chartRef.current?.setOption(option, true);
    }, [option]);

    return <div ref={elRef} role="img" aria-label={label} className="h-full w-full" />;
};
