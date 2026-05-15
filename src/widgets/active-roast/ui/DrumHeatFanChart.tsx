import React, { useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { CHART_COLORS, CONTROL_COLORS } from '@features/active-roast/lib/chart-config';

interface Props {
    xs: number[];
    drumTemp: (number | null)[];
    heatPower: (number | null)[];
    fanSpeed: (number | null)[];
    currentTimeSec: number;
    height: number;
    temperatureUnit?: 'C' | 'F';
    xMin?: number;
    xMax?: number;
}

const fmtSec = (v: number) => {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

export const DrumHeatFanChart: React.FC<Props> = ({
    xs,
    drumTemp,
    heatPower,
    fanSpeed,
    currentTimeSec,
    height,
    temperatureUnit = 'C',
    xMin,
    xMax,
}) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstanceRef = useRef<echarts.ECharts | null>(null);

    // ECharts 초기화
    useEffect(() => {
        const container = chartRef.current;
        if (!container) return;

        const chart = echarts.init(container, undefined, { renderer: 'canvas' });
        chartInstanceRef.current = chart;

        const resizeObserver = new ResizeObserver(() => chart.resize());
        resizeObserver.observe(container);

        return () => {
            resizeObserver.disconnect();
            chart.dispose();
            chartInstanceRef.current = null;
        };
    }, []);

    const option = useMemo((): EChartsOption => {
        const unitLabel = temperatureUnit === 'C' ? '℃' : '℉';

        return {
            backgroundColor: 'transparent',
            animation: false,
            grid: { left: 36, right: 12, top: 20, bottom: 40 },
            tooltip: {
                trigger: 'axis',
                formatter: (params: any) => {
                    const time = params[0]?.axisValue ?? 0;
                    let html = `<div style="font-weight:500;margin-bottom:4px">${fmtSec(time)}</div>`;
                    params.forEach((p: any) => {
                        if (p.seriesName === 'Drum')
                            html += `Drum: <span style="color:${CONTROL_COLORS.drum};font-weight:600">${p.value[1]?.toFixed(1)}${unitLabel}</span><br>`;
                        if (p.seriesName === 'Heat')
                            html += `Heat: <span style="color:${CONTROL_COLORS.heat};font-weight:600">${p.value[1]?.toFixed(0)}%</span><br>`;
                        if (p.seriesName === 'Fan')
                            html += `Fan: <span style="color:${CONTROL_COLORS.fan};font-weight:600">${p.value[1]?.toFixed(0)}%</span>`;
                    });
                    return html;
                },
            },
            xAxis: {
                type: 'value',
                axisLabel: { formatter: fmtSec, fontSize: 10 },
                min: xMin ?? xs[0] ?? 0,
                max: xMax ?? xs[xs.length - 1] ?? 1200,
            },
            yAxis: [
                {
                    type: 'value',
                    name: `Drum (${unitLabel})`,
                    position: 'left',
                    min: 0,
                    max: temperatureUnit === 'F' ? 500 : 260,
                },
                { type: 'value', name: 'Power / Speed (%)', position: 'right', min: 0, max: 100 },
            ],
            series: [
                {
                    name: 'Drum',
                    type: 'line',
                    yAxisIndex: 0,
                    data: xs.map((x, i) => [x, drumTemp[i]]),
                    lineStyle: { color: CONTROL_COLORS.drum, width: 1 },
                    smooth: 0.3,
                },
                {
                    name: 'Heat',
                    type: 'line',
                    yAxisIndex: 1,
                    data: xs.map((x, i) => [x, heatPower[i]]),
                    lineStyle: { color: CONTROL_COLORS.heat, width: 1 },
                    smooth: 0.3,
                    areaStyle: { color: CONTROL_COLORS.heatArea },
                },
                {
                    name: 'Fan',
                    type: 'line',
                    yAxisIndex: 1,
                    data: xs.map((x, i) => [x, fanSpeed[i]]),
                    lineStyle: { color: CONTROL_COLORS.fan, width: 1 },
                    smooth: 0.3,
                    areaStyle: { color: CONTROL_COLORS.fanArea },
                },
            ],
            markLine: {
                data: [{ xAxis: currentTimeSec, lineStyle: { color: CHART_COLORS.nowLabel, width: 2 } }],
            },
        };
    }, [xs, drumTemp, heatPower, fanSpeed, currentTimeSec, temperatureUnit, xMin, xMax]);

    useEffect(() => {
        if (!chartInstanceRef.current) return;
        chartInstanceRef.current.setOption(option, { lazyUpdate: true });
    }, [option]);

    useEffect(() => {
        chartInstanceRef.current?.resize({ height });
    }, [height]);

    return <div ref={chartRef} style={{ width: '100%', height: `${height}px` }} />;
};
