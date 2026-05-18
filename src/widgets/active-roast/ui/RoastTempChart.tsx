import React, { useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { CHART_COLORS, CONTROL_COLORS, ROR_Y_MIN, ROR_Y_MAX } from '@features/active-roast/lib/chart-config';
import type { TurningPoint, TemperatureUnit } from '@features/active-roast';

export interface RoastEventMarker {
    timeSec: number;
    event: string;
    color: string;
}

interface ControlData {
    xs: number[];
    drumTemp: (number | null)[];
    heatPower: (number | null)[];
    fanSpeed: (number | null)[];
}

interface Props {
    xs: number[];
    btTarget: (number | null)[];
    btActual: (number | null)[];
    etActual: (number | null)[];
    rorActual: (number | null)[];
    currentTimeSec: number;
    eventMarkers: RoastEventMarker[];
    turningPoints?: TurningPoint[];
    temperatureUnit?: TemperatureUnit;
    height: number;
    onCursorIdx?: (idx: number | null) => void;
    onEventMarkerDrag?: (event: string, newTimeSec: number) => void;
    showET?: boolean;
    showTargetCurve?: boolean;
    showRoR?: boolean;
    controlData?: ControlData;
}

const fmtSec = (v: number) => {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

export const RoastTempChart: React.FC<Props> = ({
    xs,
    btTarget,
    btActual,
    etActual,
    rorActual,
    currentTimeSec,
    eventMarkers,
    turningPoints = [],
    temperatureUnit = 'C',
    height,
    onCursorIdx,
    onEventMarkerDrag: _onEventMarkerDrag,
    showET = true,
    showTargetCurve = true,
    showRoR = true,
    controlData,
}) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstanceRef = useRef<echarts.ECharts | null>(null);

    // TP 디버그 로그 (콘솔에서 확인 필수!)
    useEffect(() => {
        if (turningPoints.length > 0) {
            console.log('🔥 TP 감지됨!', turningPoints);
        }
    }, [turningPoints]);

    // ECharts 초기화
    useEffect((): (() => void) | undefined => {
        const container = chartRef.current;
        if (!container) return undefined;

        const chart = echarts.init(container, undefined, {
            renderer: 'canvas',
            useDirtyRect: true,
        });
        chartInstanceRef.current = chart;

        const resizeObserver = new ResizeObserver(() => chart.resize());
        resizeObserver.observe(container);

        return () => {
            resizeObserver.disconnect();
            if (chartInstanceRef.current) {
                chartInstanceRef.current.dispose();
                chartInstanceRef.current = null;
            }
        };
    }, []);

    const option = useMemo((): EChartsOption => {
        const unitLabel = temperatureUnit === 'C' ? '℃' : '℉';
        const rorUnit = temperatureUnit === 'C' ? '℃/min' : '℉/min';

        // 🔥 TypeError: undefined is not an object (data.getRawIndex) 해결
        const makeSeriesData = (arr: (number | null)[]) => xs.map((x, i) => [x, arr[i] ?? null]);

        /**
         * 커피 로스팅 차트에 최적화된 스무딩 설정
         * - BT: 0.42 (자연스러운 곡선)
         * - ET: 0.38 (BT보다 약간 덜 휘게)
         * - RoR: 0.28 (노이즈 많아서 더 부드럽게)
         */
        const getSmoothConfig = (strength: number = 0.4) => ({
            smooth: strength,
            smoothMonotone: 'x' as const, // 시간축 방향으로만 스무딩 (역행 방지)
            sampling: 'lttb' as const,
        });
        // const currentTimeMarkLine = {
        //     data: [
        //         {
        //             xAxis: currentTimeSec,
        //             lineStyle: { color: CHART_COLORS.currentTimeLine, width: 2, type: 'solid' as const },
        //             label: {
        //                 formatter: `NOW\n${fmtSec(currentTimeSec)}`,
        //                 position: 'top',
        //                 color: CHART_COLORS.nowLabel,
        //                 fontWeight: 700,
        //                 fontSize: 11,
        //             },
        //         },
        //     ],
        // };

        const tpMarkLines = turningPoints.map((tp) => ({
            xAxis: tp.timeSec,
            lineStyle: {
                color: CHART_COLORS.tp,
                width: 1.5,
                type: 'solid' as const,
                opacity: 1,
            },
            label: {
                show: true,
                position: 'end',
                formatter: 'TP',
                color: CHART_COLORS.tp,
                fontSize: 12,
                fontWeight: 700,
            },
        }));

        const eventMarkLines = eventMarkers.map((m) => ({
            xAxis: m.timeSec,
            lineStyle: {
                color: m.color,
                width: 1.5,
                type: 'solid' as const,
                opacity: 0.8,
            },
            label: {
                show: true,
                position: 'end',
                formatter: m.event,
                color: m.color,
                fontSize: 11,
                fontWeight: 600,
            },
        }));

        const markPointData = [
            ...eventMarkers.map((m) => ({
                name: m.event,
                value: [m.timeSec, null],
                xAxis: m.timeSec,
                symbol: 'circle',
                symbolSize: 10,
                itemStyle: { color: m.color, borderColor: CHART_COLORS.markerLabelColor, borderWidth: 2 },
                label: {
                    show: true,
                    position: 'top',
                    formatter: m.event,
                    fontSize: 10,
                    color: CHART_COLORS.markerLabelColor,
                    backgroundColor: m.color,
                    padding: [2, 4],
                    borderRadius: 2,
                },
            })),
        ];

        const xMin = xs[0] ?? 0;
        const xMax = xs[xs.length - 1] ?? 1200;
        const rightMargin = showRoR ? 65 : 65;

        const tempSeries = [
            showTargetCurve && {
                name: 'BT Target',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: makeSeriesData(btTarget),
                lineStyle: { color: CHART_COLORS.btTarget, width: 1.5, type: 'dashed' },
                showSymbol: false,
                smooth: false,
            },
            {
                name: 'BT Actual',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: xs.map((x, i) => [x, btActual[i]]),
                lineStyle: { color: CHART_COLORS.btActual, width: 1.8 },
                showSymbol: false,
                ...getSmoothConfig(0.7),
                markLine: {
                    silent: true,
                    symbol: 'none',
                    data: [...eventMarkLines, ...tpMarkLines],
                },
                markPoint: { data: markPointData },
            },
            showET && {
                name: 'ET Actual',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: xs.map((x, i) => [x, etActual[i]]),
                lineStyle: { color: CHART_COLORS.etActual, width: 1.5 },
                showSymbol: false,
                ...getSmoothConfig(0.65),
            },
            showRoR && {
                name: 'RoR',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 1,
                data: xs.map((x, i) => [x, rorActual[i]]),
                lineStyle: { color: CHART_COLORS.rorActual, width: 1.2 },
                showSymbol: false,
                ...getSmoothConfig(0.28), // RoR — 노이즈 많아서 더 부드럽게
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: `${CHART_COLORS.rorActual}33` },
                        { offset: 1, color: `${CHART_COLORS.rorActual}00` },
                    ]),
                },
            },
        ].filter(Boolean) as any[];

        if (controlData) {
            const { xs: cxs, drumTemp, heatPower, fanSpeed } = controlData;
            return {
                backgroundColor: 'transparent',
                animation: false,
                axisPointer: { link: [{ xAxisIndex: 'all' }], label: { show: false } },
                grid: [
                    { left: 55, right: rightMargin, top: 20, height: '61%' },
                    { left: 55, right: rightMargin, top: '68%', bottom: 40 },
                ],
                xAxis: [
                    {
                        gridIndex: 0,
                        type: 'value',
                        min: xMin,
                        max: xMax,
                        axisLabel: { show: false },
                        axisTick: { show: false },
                        axisLine: { show: false },
                        splitLine: { show: true, lineStyle: { color: CHART_COLORS.gridLine, width: 0.5 } },
                        interval: 60,
                        splitNumber: 15,
                    },
                    {
                        gridIndex: 1,
                        type: 'value',
                        min: xMin,
                        max: xMax,
                        axisLabel: { formatter: fmtSec, fontSize: 11, fontFamily: 'monospace' },
                        interval: 60,
                        splitNumber: 15,
                        splitLine: { show: true, lineStyle: { color: CHART_COLORS.gridLine, width: 0.5 } },
                    },
                ],
                yAxis: [
                    {
                        gridIndex: 0,
                        type: 'value',
                        name: `Temperature (${unitLabel})`,
                        nameGap: 35,
                        axisLabel: { fontSize: 11, fontFamily: 'monospace' },
                        splitLine: { show: true, lineStyle: { color: CHART_COLORS.gridLine, width: 0.5 } },
                        minorTick: { show: true, splitNumber: 2 },
                        minorSplitLine: { show: true, lineStyle: { color: CHART_COLORS.gridLineMinor, width: 0.5 } },
                        min: temperatureUnit === 'F' ? 266 : 130,
                        max: temperatureUnit === 'F' ? 464 : 240,
                        interval: 20,
                    },
                    {
                        gridIndex: 0,
                        type: 'value',
                        name: `RoR (${rorUnit})`,
                        nameGap: 35,
                        position: 'right',
                        axisLabel: { fontSize: 11, fontFamily: 'monospace' },
                        splitLine: { show: false },
                        min: ROR_Y_MIN,
                        max: ROR_Y_MAX,
                        interval: 20,
                    },
                    {
                        gridIndex: 1,
                        type: 'value',
                        // TODO: RoastSettings에서 Drum 축 범위(min/max)를 사용자 설정 가능하게 연결
                        name: 'Drum (rpm)',
                        position: 'left',
                        axisLabel: { fontSize: 10, fontFamily: 'monospace' },
                        splitLine: { show: true, lineStyle: { color: CHART_COLORS.gridLine } },
                        min: 0,
                        max: 100,
                    },
                    {
                        gridIndex: 1,
                        type: 'value',
                        name: 'Power / Speed (%)',
                        position: 'right',
                        axisLabel: { fontSize: 10, fontFamily: 'monospace' },
                        splitLine: { show: false },
                        min: 0,
                        max: 100,
                    },
                ],
                tooltip: {
                    trigger: 'axis',
                    axisPointer: { type: 'line', lineStyle: { color: CHART_COLORS.axisPointerLine, width: 1 } },
                },
                series: [
                    ...tempSeries,
                    {
                        name: 'Drum',
                        type: 'line',
                        color: CONTROL_COLORS.drum,
                        xAxisIndex: 1,
                        yAxisIndex: 2,
                        data: cxs.map((x, i) => [x, drumTemp[i]]),
                        lineStyle: { color: CONTROL_COLORS.drum, width: 1.5 },
                        showSymbol: false,
                        smooth: 0.3,
                    },
                    {
                        name: 'Heat',
                        type: 'line',
                        color: CONTROL_COLORS.heat,
                        xAxisIndex: 1,
                        yAxisIndex: 3,
                        data: cxs.map((x, i) => [x, heatPower[i]]),
                        lineStyle: { color: CONTROL_COLORS.heat, width: 1.5 },
                        showSymbol: false,
                        step: 'end',
                        smooth: false,
                        // areaStyle: { color: CONTROL_COLORS.heatArea },
                    },
                    {
                        name: 'Fan',
                        type: 'line',
                        color: CONTROL_COLORS.fan,
                        xAxisIndex: 1,
                        yAxisIndex: 3,
                        data: cxs.map((x, i) => [x, fanSpeed[i]]),
                        lineStyle: { color: CONTROL_COLORS.fan, width: 1.5 },
                        showSymbol: false,
                        step: 'end',
                        smooth: false,
                        // areaStyle: { color: CONTROL_COLORS.fanArea },
                    },
                ],
                dataZoom: [
                    { type: 'inside', xAxisIndex: 0, zoomOnMouseWheel: true, moveOnMouseMove: true },
                    { type: 'inside', xAxisIndex: 1, zoomOnMouseWheel: true, moveOnMouseMove: true },
                ],
            };
        }

        return {
            backgroundColor: 'transparent',
            animation: false,
            grid: { left: 55, right: showRoR ? 65 : 25, top: 20, bottom: 65 },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross', lineStyle: { color: CHART_COLORS.axisPointerLine, width: 1 } },
                formatter: (params: any) => {
                    const timeSec = params[0]?.axisValue ?? 0;
                    let html = `<div style="font-weight:500;color:${CHART_COLORS.tooltipTimeColor};margin-bottom:6px">${fmtSec(timeSec)}</div>`;
                    params.forEach((p: any) => {
                        if (p.seriesName === 'BT Target')
                            html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.btTarget};border-radius:2px"></div>Target BT: <span style="font-weight:600">${p.value[1]?.toFixed(1)}${unitLabel}</span></div>`;
                        if (p.seriesName === 'BT Actual')
                            html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.btActual};border-radius:2px"></div>Bean Temp: <span style="font-weight:600">${p.value[1]?.toFixed(1)}${unitLabel}</span></div>`;
                        if (p.seriesName === 'ET Actual' && showET)
                            html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.etActual};border-radius:2px"></div>Env Temp: <span style="font-weight:600">${p.value[1]?.toFixed(1)}${unitLabel}</span></div>`;
                        if (p.seriesName === 'RoR' && showRoR)
                            html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.rorActual};border-radius:2px"></div>RoR: <span style="font-weight:600">${p.value[1]?.toFixed(1)}${rorUnit}</span></div>`;
                    });
                    return html;
                },
            },
            xAxis: {
                type: 'value',
                name: 'Time (min)',
                nameLocation: 'middle',
                nameGap: 35,
                min: xMin,
                max: xMax,
                axisLabel: { formatter: (v: number) => fmtSec(v), fontSize: 11, fontFamily: 'monospace' },
                interval: 60,
                splitNumber: 15,
                splitLine: { show: true, lineStyle: { color: CHART_COLORS.gridLine, width: 1 } },
            },
            yAxis: [
                {
                    type: 'value',
                    name: `Temperature (${unitLabel})`,
                    nameGap: 35,
                    axisLabel: { fontSize: 11, fontFamily: 'monospace' },
                    splitLine: { show: true, lineStyle: { color: CHART_COLORS.gridLine } },
                    min: temperatureUnit === 'F' ? 266 : 130,
                    max: temperatureUnit === 'F' ? 464 : 240,
                    interval: 20,
                },
                {
                    type: 'value',
                    name: `RoR (${rorUnit})`,
                    nameGap: 35,
                    position: 'right',
                    axisLabel: { fontSize: 11, fontFamily: 'monospace' },
                    splitLine: { show: false },
                    min: ROR_Y_MIN,
                    max: ROR_Y_MAX,
                    interval: 20,
                },
            ],
            series: tempSeries,
            dataZoom: [{ type: 'inside', xAxisIndex: 0, zoomOnMouseWheel: true, moveOnMouseMove: true }],
        };
    }, [
        xs,
        btTarget,
        btActual,
        etActual,
        rorActual,
        currentTimeSec,
        eventMarkers,
        turningPoints,
        temperatureUnit,
        showET,
        showTargetCurve,
        showRoR,
        controlData,
    ]);

    // 옵션 적용 — controlData 유무가 바뀌면 (single↔combined) notMerge로 완전 교체
    const prevHasControlData = useRef(!!controlData);
    useEffect(() => {
        const chart = chartInstanceRef.current;
        if (!chart) return;
        const structureChanged = prevHasControlData.current !== !!controlData;
        prevHasControlData.current = !!controlData;
        chart.setOption(option, {
            notMerge: structureChanged,
            lazyUpdate: !structureChanged,
        });
    }, [option]);

    // 마우스 호버
    useEffect(() => {
        const chart = chartInstanceRef.current;
        if (!chart || !onCursorIdx) return;

        const handleMouseMove = (e: any) => {
            const pixel: [number, number] = [e.offsetX, e.offsetY];
            const point = chart.convertFromPixel({ xAxisIndex: 0 }, pixel);
            if (point && xs.length) {
                const idx = xs.reduce(
                    (prev, curr, i) => (Math.abs(curr - point[0]) < Math.abs(xs[prev] - point[0]) ? i : prev),
                    0,
                );
                onCursorIdx(idx);
            }
        };

        chart.on('mousemove', handleMouseMove);
        return () => {
            chart.off('mousemove', handleMouseMove);
        };
    }, [xs, onCursorIdx]);

    useEffect(() => {
        chartInstanceRef.current?.resize({ height });
    }, [height]);

    return (
        <div style={{ position: 'relative', width: '100%', height: `${height}px`, minHeight: '300px' }}>
            <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
            {controlData && (
                <div className="absolute flex items-center gap-4" style={{ bottom: -5, left: 25 }}>
                    {[
                        { color: CONTROL_COLORS.drum, label: 'Drum' },
                        { color: CONTROL_COLORS.heat, label: 'Heat' },
                        { color: CONTROL_COLORS.fan, label: 'Fan' },
                    ].map(({ color, label }) => (
                        <div key={label} className="flex items-center gap-1.5">
                            <div style={{ width: 16, height: 2, borderRadius: 1, background: color }} />
                            <span className="text-[11px] text-muted tracking-[0.14px]">{label}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
