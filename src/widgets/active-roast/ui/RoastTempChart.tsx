import type { PhaseSegment, TemperatureUnit, TurningPoint } from '@features/active-roast';
import {
    AXIS_LABEL_FONT,
    CHART_COLORS,
    CHART_GRID_LEFT,
    CHART_GRID_RIGHT,
    CHART_GRID_RIGHT_WITH_ROR,
    CHART_GRID_TOP,
    CONTROL_COLORS,
    CONTROL_GRID_BOTTOM,
    CONTROL_GRID_BOTTOM_GAP,
    CONTROL_GRID_TOP,
    CONTROL_GRID_TOP_WITH_PHASE,
    getResolvedChartColors,
    PHASE_BAR_BOTTOM,
    PHASE_BAR_DURATION_COLOR,
    PHASE_BAR_FONT_FAMILY,
    PHASE_BAR_FONT_SIZE,
    PHASE_BAR_FONT_SIZE_NARROW,
    PHASE_BAR_FONT_WEIGHT,
    PHASE_BAR_HEIGHT,
    PHASE_BAR_NAME_COLOR,
    PHASE_BAR_NARROW_THRESHOLD,
    PHASE_BAR_STROKE,
    PHASE_BAR_STROKE_WIDTH,
    PHASE_BAR_TEXT_INSET,
    PHASE_BAR_WIDE_THRESHOLD,
    PHASE_GRID_TOP,
    ROR_Y_MAX,
    ROR_Y_MIN,
    SINGLE_GRID_BOTTOM,
    TEMP_GRID_HEIGHT,
    TEMP_GRID_HEIGHT_WITH_PHASE,
    TEMP_Y_INTERVAL,
    TEMP_Y_MAX_C,
    TEMP_Y_MAX_F,
    TEMP_Y_MIN_C,
    TEMP_Y_MIN_F,
    Y_AXIS_NAME_GAP,
} from '@features/active-roast/lib/chart-config';
import { useThemeStore } from '@shared/store/theme';
import type { EChartsOption } from 'echarts';
import * as echarts from 'echarts';
import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
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
    showRoRET?: boolean;
    rorEtActual?: (number | null)[];
    controlData?: ControlData;
    phaseSegments?: PhaseSegment[];
}

const fmtSec = (v: number) => {
    const sign = v < 0 ? '-' : '';
    const abs = Math.abs(v);
    const m = Math.floor(abs / 60);
    const s = Math.round(abs % 60);
    return `${sign}${m}:${String(s).padStart(2, '0')}`;
};

/** Approximate perceived brightness of a hex color (0–255). */
const luminance = (hex: string): number => {
    const c = hex.replace('#', '');
    if (c.length < 6) return 255;
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
};

export const RoastTempChart: React.FC<Props> = ({
    xs,
    btTarget,
    btActual,
    etActual,
    rorActual,
    eventMarkers,
    turningPoints = [],
    temperatureUnit = 'C',
    height,
    onCursorIdx,
    onEventMarkerDrag,
    showET = true,
    showTargetCurve = true,
    showRoR = true,
    showRoRET = false,
    rorEtActual = [],
    controlData,
    phaseSegments = [],
}) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstanceRef = useRef<echarts.ECharts | null>(null);
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

    // ── 마커 드래그 상태 ─────────────────────────────────────────
    const dragStateRef = useRef<{
        active: boolean;
        eventName: string;
        startX: number;
        startTimeSec: number;
    } | null>(null);
    const PIXEL_THRESHOLD = 10;

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
        const colors = getResolvedChartColors();
        const axisLabelStyle = { ...AXIS_LABEL_FONT, color: colors.axisLabel };
        const axisNameStyle = { color: colors.axisLabel };
        const rightYAxisLabel = { ...axisLabelStyle, margin: 4 };

        const unitLabel = temperatureUnit === 'C' ? '℃' : '℉';
        const rorUnit = temperatureUnit === 'C' ? '℃/min' : '℉/min';

        // 🔥 TypeError 해결: ECharts가 undefined 값을 처리 못해서
        // 명시적으로 [x값, y값] 튜플로 변환하면 getRawIndex 에러 방지
        // arr[i]가 undefined면 null로 변환하여 ECharts 렌더링 안정화
        const makeSeriesData = (arr: (number | null)[]) => xs.map((x, i) => [x, arr[i] ?? null]);

        // 커피 로스팅 차트에 최적화된 스무딩 설정
        // - BT(Bean Temp): 0.42 → 자연스러운 곡선, 노이즈 최소화
        // - ET(Environment Temp): 0.38 → BT보다 약간 덜 휘게 (안정적 표현)
        // - RoR(Rate of Rise): 0.28 → 센서 노이즈 많아서 더 부드럽게
        // - smoothMonotone 'x' → 시간축 방향으로만 스무딩 (역행 방지)
        // - sampling 'lttb' → Largest-Triangle-Three-Buckets 알고리즘 (성능 + 품질)
        const getSmoothConfig = (strength: number = 0.4) => ({
            smooth: strength,
            smoothMonotone: 'x' as const,
            sampling: 'lttb' as const,
        });

        const tpMarkLines = turningPoints.map((tp) => ({
            xAxis: tp.timeSec,
            lineStyle: {
                color: colors.tp,
                width: 1.5,
                type: 'solid' as const,
                opacity: 1,
            },
            label: {
                show: true,
                position: 'start',
                formatter: 'TP',
                color: colors.tp,
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
                show: false,
            },
        }));

        const markPointData = eventMarkers.map((m) => {
            const isLight = luminance(m.color) > 160;
            return {
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
                    color: isLight ? '#0B0B0B' : CHART_COLORS.markerLabelColor,
                    backgroundColor: m.color,
                    padding: [2, 4],
                },
            };
        });

        const xMin = xs[0] ?? 0;
        const xMax = xs[xs.length - 1] ?? 1200;
        const hasRightYAxis = showRoR || !!controlData;
        const rightMargin = hasRightYAxis ? CHART_GRID_RIGHT_WITH_ROR : CHART_GRID_RIGHT;
        const leftMargin = CHART_GRID_LEFT;
        const topMargin = CHART_GRID_TOP;

        const tempSeries = [
            showTargetCurve && {
                name: 'BT Target',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                z: 1,
                data: makeSeriesData(btTarget),
                lineStyle: { color: colors.btTarget, width: 1.5, type: 'dashed', opacity: 0.55 },
                areaStyle: { color: colors.btTarget, opacity: 0.06 },
                showSymbol: false,
                smooth: false,
            },
            {
                name: 'BT Actual',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                z: 2,
                data: xs.map((x, i) => [x, btActual[i]]),
                lineStyle: { color: colors.btActual, width: 1.8 },
                showSymbol: false,
                ...getSmoothConfig(0.7),
                markLine: {
                    silent: false,
                    symbol: ['none', 'circle'],
                    symbolSize: [0, 8],
                    data: [...eventMarkLines, ...tpMarkLines],
                },
                markPoint: { data: markPointData },
            },
            showET && {
                name: 'ET Actual',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                z: 2,
                data: xs.map((x, i) => [x, etActual[i]]),
                lineStyle: { color: colors.etActual, width: 1.5 },
                showSymbol: false,
                ...getSmoothConfig(0.65),
            },
            showRoR && {
                name: 'RoR',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 1,
                data: xs.map((x, i) => [x, rorActual[i]]),
                lineStyle: { color: colors.rorActual, width: 1.2 },
                showSymbol: false,
                ...getSmoothConfig(0.28),
            },
            showRoR &&
                showRoRET && {
                    name: 'ET RoR',
                    type: 'line',
                    xAxisIndex: 0,
                    yAxisIndex: 1,
                    data: xs.map((x, i) => [x, rorEtActual[i] ?? null]),
                    lineStyle: { color: colors.etActual, width: 1.0, type: 'dashed' },
                    showSymbol: false,
                    ...getSmoothConfig(0.28),
                },
        ].filter(Boolean) as object[];

        // ── Phase bar (로스팅 단계 시각화) ────────────────────────────────────
        // 로스팅 프로필을 "Dry", "Development", "Cooling" 등의 단계로 나누어
        // 차트 하단에 색상 막대로 표시하고 각 단계의 시간과 비율을 표기.
        // - phaseSegments가 있을 때만 활성화
        // - 활성화 시 하단에 별도 grid(3번째)를 추가하고 시간 축 라벨을 그쪽으로 이동
        const hasPhaseBar = phaseSegments.length > 0;

        const buildPhaseSeries = (xAxisIdx: number, yAxisIdx: number) => ({
            type: 'custom' as const,
            xAxisIndex: xAxisIdx,
            yAxisIndex: yAxisIdx,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            renderItem: (params: any, api: any) => {
                // 시간축(x) 데이터를 픽셀 좌표로 변환
                const startPx = api.coord([api.value(0), 0])[0];
                const endPx = api.coord([api.value(1), 0])[0];
                const width = Math.max(0, endPx - startPx);
                const { y, height: h } = params.coordSys;

                // 각 단계의 메타데이터
                const durSec = api.value(2) as number;
                const pct = api.value(3) as number;
                const color = api.value(4) as string;
                const name = api.value(5) as string;
                const durMin = Math.floor(durSec / 60);
                const durS = String(durSec % 60).padStart(2, '0');
                const durLabel = `${durMin}:${durS}  ${pct}%`;

                // 단계별 배경 박스 생성
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const children: any[] = [
                    {
                        type: 'rect',
                        shape: { x: startPx, y, width, height: h },
                        style: { fill: color, stroke: PHASE_BAR_STROKE, lineWidth: PHASE_BAR_STROKE_WIDTH },
                        silent: true,
                    },
                ];

                // 너비에 따라 텍스트 배치 전략 변경
                // - width > WIDE: 단계명 좌측 + 시간 우측 (여유있음)
                // - width > NARROW: 시간을 중앙에 (공간 제한)
                // - width ≤ NARROW: 텍스트 생략 (너무 좁음)
                if (width > PHASE_BAR_WIDE_THRESHOLD) {
                    children.push({
                        type: 'text',
                        style: {
                            text: name,
                            x: startPx + PHASE_BAR_TEXT_INSET,
                            y: y + h / 2,
                            fontSize: PHASE_BAR_FONT_SIZE,
                            fontFamily: PHASE_BAR_FONT_FAMILY,
                            fontWeight: PHASE_BAR_FONT_WEIGHT,
                            fill: PHASE_BAR_NAME_COLOR,
                            textVerticalAlign: 'middle',
                        },
                        silent: true,
                    });
                    children.push({
                        type: 'text',
                        style: {
                            text: durLabel,
                            x: endPx - PHASE_BAR_TEXT_INSET,
                            y: y + h / 2,
                            fontSize: PHASE_BAR_FONT_SIZE,
                            fontFamily: PHASE_BAR_FONT_FAMILY,
                            fill: PHASE_BAR_DURATION_COLOR,
                            textAlign: 'right',
                            textVerticalAlign: 'middle',
                        },
                        silent: true,
                    });
                } else if (width > PHASE_BAR_NARROW_THRESHOLD) {
                    children.push({
                        type: 'text',
                        style: {
                            text: durLabel,
                            x: (startPx + endPx) / 2,
                            y: y + h / 2,
                            fontSize: PHASE_BAR_FONT_SIZE_NARROW,
                            fontFamily: PHASE_BAR_FONT_FAMILY,
                            fill: PHASE_BAR_DURATION_COLOR,
                            textAlign: 'center',
                            textVerticalAlign: 'middle',
                        },
                        silent: true,
                    });
                }

                return { type: 'group', children };
            },
            // 각 단계 데이터: [startSec, endSec, durationSec, percentage, color, name]
            data: phaseSegments.map((seg) => [seg.startSec, seg.endSec, seg.durationSec, seg.pct, seg.color, seg.name]),
            z: 5,
        });

        if (controlData) {
            const { xs: cxs, drumTemp, heatPower, fanSpeed } = controlData;
            // Grid 레이아웃:
            // [0] 온도 차트 (BT, ET, RoR) - 상단 48%
            // [1] Phase bar (Drying/Maillard/Development) - 중간 (있을 때만)
            // [2] 제어 데이터 (Drum, Heat, Fan) - 하단
            //
            // 시간 축 라벨은:
            // - Phase bar 있으면 → grid[1] 하단에 표시
            // - Phase bar 없으면 → grid[2] 하단에 표시
            const controlBottom = hasPhaseBar
                ? PHASE_BAR_BOTTOM + PHASE_BAR_HEIGHT + CONTROL_GRID_BOTTOM_GAP
                : CONTROL_GRID_BOTTOM;
            const grids: {
                left: number;
                right: number;
                top: string | number;
                height?: string;
                bottom?: string | number;
            }[] = hasPhaseBar
                ? [
                      { left: leftMargin, right: rightMargin, top: topMargin, height: TEMP_GRID_HEIGHT_WITH_PHASE },
                      {
                          left: leftMargin,
                          right: rightMargin,
                          top: CONTROL_GRID_TOP_WITH_PHASE,
                          height: `${PHASE_BAR_HEIGHT}px`,
                      },
                      { left: leftMargin, right: rightMargin, top: PHASE_GRID_TOP, bottom: controlBottom },
                  ]
                : [
                      { left: leftMargin, right: rightMargin, top: topMargin, height: TEMP_GRID_HEIGHT },
                      { left: leftMargin, right: rightMargin, top: CONTROL_GRID_TOP, bottom: controlBottom },
                  ];
            const xAxes = hasPhaseBar
                ? [
                      {
                          gridIndex: 0,
                          type: 'value' as const,
                          min: xMin,
                          max: xMax,
                          axisLabel: { show: false },
                          axisTick: { show: false },
                          axisLine: { show: false },
                          splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 0.5 } },
                          interval: 60,
                          splitNumber: 15,
                      },
                      {
                          gridIndex: 1,
                          type: 'value',
                          min: xMin,
                          max: xMax,
                          axisLabel: { show: false },
                          axisTick: { show: false },
                          axisLine: { show: false },
                          splitLine: { show: false },
                          interval: 60,
                          splitNumber: 15,
                      },
                      {
                          gridIndex: 2,
                          type: 'value',
                          min: xMin,
                          max: xMax,
                          axisLabel: { formatter: fmtSec, ...axisLabelStyle },
                          axisTick: { show: false },
                          interval: 60,
                          splitNumber: 15,
                          splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 0.5 } },
                      },
                  ]
                : [
                      {
                          gridIndex: 0,
                          type: 'value',
                          min: xMin,
                          max: xMax,
                          axisLabel: { show: false },
                          axisTick: { show: false },
                          axisLine: { show: false },
                          splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 0.5 } },
                          interval: 60,
                          splitNumber: 15,
                      },
                      {
                          gridIndex: 1,
                          type: 'value',
                          min: xMin,
                          max: xMax,
                          axisLabel: { formatter: fmtSec, ...axisLabelStyle },
                          axisTick: { show: false },
                          interval: 60,
                          splitNumber: 15,
                          splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 0.5 } },
                      },
                  ];
            const yAxes = hasPhaseBar
                ? [
                      {
                          gridIndex: 0,
                          type: 'value',
                          name: `Temperature (${unitLabel})`,
                          nameLocation: 'middle',
                          nameGap: Y_AXIS_NAME_GAP,
                          nameTextStyle: axisNameStyle,
                          axisLine: { onZero: false },
                          axisLabel: axisLabelStyle,
                          splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 0.5 } },
                          minorTick: { show: true, splitNumber: 2 },
                          minorSplitLine: { show: true, lineStyle: { color: colors.gridLineMinor, width: 0.5 } },
                          min: temperatureUnit === 'F' ? TEMP_Y_MIN_F : TEMP_Y_MIN_C,
                          max: temperatureUnit === 'F' ? TEMP_Y_MAX_F : TEMP_Y_MAX_C,
                          interval: TEMP_Y_INTERVAL,
                      },
                      {
                          gridIndex: 0,
                          type: 'value',
                          name: `RoR (${rorUnit})`,
                          nameLocation: 'middle',
                          nameGap: Y_AXIS_NAME_GAP,
                          nameTextStyle: axisNameStyle,
                          position: 'right',
                          axisLine: { onZero: false },
                          axisLabel: rightYAxisLabel,
                          splitLine: { show: false },
                          min: ROR_Y_MIN,
                          max: ROR_Y_MAX,
                          interval: 20,
                      },
                      {
                          gridIndex: 1,
                          type: 'value',
                          min: 0,
                          max: 1,
                          show: false,
                      },
                      {
                          gridIndex: 2,
                          type: 'value',
                          name: 'Drum (rpm)',
                          nameLocation: 'middle',
                          nameGap: Y_AXIS_NAME_GAP,
                          nameTextStyle: axisNameStyle,
                          position: 'left',
                          axisLine: { onZero: false },
                          axisLabel: rightYAxisLabel,
                          splitLine: { show: true, lineStyle: { color: colors.gridLine } },
                          min: 0,
                          max: 100,
                      },
                      {
                          gridIndex: 2,
                          type: 'value',
                          name: 'Power / Speed (%)',
                          nameLocation: 'middle',
                          nameGap: Y_AXIS_NAME_GAP,
                          nameTextStyle: axisNameStyle,
                          position: 'right',
                          axisLine: { onZero: false },
                          axisLabel: { show: false },
                          splitLine: { show: false },
                          min: 0,
                          max: 100,
                      },
                  ]
                : [
                      {
                          gridIndex: 0,
                          type: 'value',
                          name: `Temperature (${unitLabel})`,
                          nameLocation: 'middle',
                          nameGap: Y_AXIS_NAME_GAP,
                          nameTextStyle: axisNameStyle,
                          axisLine: { onZero: false },
                          axisLabel: axisLabelStyle,
                          splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 0.5 } },
                          minorTick: { show: true, splitNumber: 2 },
                          minorSplitLine: { show: true, lineStyle: { color: colors.gridLineMinor, width: 0.5 } },
                          min: temperatureUnit === 'F' ? TEMP_Y_MIN_F : TEMP_Y_MIN_C,
                          max: temperatureUnit === 'F' ? TEMP_Y_MAX_F : TEMP_Y_MAX_C,
                          interval: TEMP_Y_INTERVAL,
                      },
                      {
                          gridIndex: 0,
                          type: 'value',
                          name: `RoR (${rorUnit})`,
                          nameLocation: 'middle',
                          nameGap: Y_AXIS_NAME_GAP,
                          nameTextStyle: axisNameStyle,
                          position: 'right',
                          axisLine: { onZero: false },
                          axisLabel: rightYAxisLabel,
                          splitLine: { show: false },
                          min: ROR_Y_MIN,
                          max: ROR_Y_MAX,
                          interval: 20,
                      },
                      {
                          gridIndex: 1,
                          type: 'value',
                          name: 'Drum (rpm)',
                          nameLocation: 'middle',
                          nameGap: Y_AXIS_NAME_GAP,
                          nameTextStyle: axisNameStyle,
                          position: 'left',
                          axisLine: { onZero: false },
                          axisLabel: rightYAxisLabel,
                          splitLine: { show: true, lineStyle: { color: colors.gridLine } },
                          min: 0,
                          max: 100,
                      },
                      {
                          gridIndex: 1,
                          type: 'value',
                          name: 'Power / Speed (%)',
                          nameLocation: 'middle',
                          nameGap: Y_AXIS_NAME_GAP,
                          nameTextStyle: axisNameStyle,
                          position: 'right',
                          axisLine: { onZero: false },
                          axisLabel: { show: false },
                          splitLine: { show: false },
                          min: 0,
                          max: 100,
                      },
                  ];
            return {
                backgroundColor: 'transparent',
                animation: false,
                axisPointer: { link: [{ xAxisIndex: hasPhaseBar ? [0, 1, 2] : [0, 1] }], label: { show: false } },
                grid: grids,
                xAxis: xAxes as EChartsOption['xAxis'],
                yAxis: yAxes as EChartsOption['yAxis'],
                tooltip: {
                    trigger: 'axis',
                    borderWidth: 1,
                    borderColor: 'rgba(0,0,0,0.08)',
                    extraCssText: 'box-shadow: none;',
                    axisPointer: { type: 'line', lineStyle: { color: CHART_COLORS.axisPointerLine, width: 1 } },
                },
                series: [
                    ...tempSeries,
                    {
                        name: 'Drum',
                        type: 'line',
                        color: colors.controlDrum,
                        xAxisIndex: hasPhaseBar ? 2 : 1,
                        yAxisIndex: hasPhaseBar ? 3 : 2,
                        data: cxs.map((x, i) => [x, drumTemp[i]]),
                        lineStyle: { color: colors.controlDrum, width: 1.5 },
                        showSymbol: false,
                        smooth: 0.3,
                    },
                    {
                        name: 'Heat',
                        type: 'line',
                        color: colors.controlHeat,
                        xAxisIndex: hasPhaseBar ? 2 : 1,
                        yAxisIndex: hasPhaseBar ? 4 : 3,
                        data: cxs.map((x, i) => [x, heatPower[i]]),
                        lineStyle: { color: colors.controlHeat, width: 1.5 },
                        showSymbol: false,
                        step: 'end',
                        smooth: false,
                    },
                    {
                        name: 'Fan',
                        type: 'line',
                        color: colors.controlFan,
                        xAxisIndex: hasPhaseBar ? 2 : 1,
                        yAxisIndex: hasPhaseBar ? 4 : 3,
                        data: cxs.map((x, i) => [x, fanSpeed[i]]),
                        lineStyle: { color: colors.controlFan, width: 1.5 },
                        showSymbol: false,
                        step: 'end',
                        smooth: false,
                    },
                    ...(hasPhaseBar ? [buildPhaseSeries(1, 2)] : []),
                ],
                dataZoom: [
                    {
                        type: 'inside',
                        xAxisIndex: hasPhaseBar ? [0, 1, 2] : [0, 1],
                        zoomOnMouseWheel: true,
                        moveOnMouseMove: false,
                        moveOnMouseWheel: true,
                    },
                ],
            };
        }

        const singleBottom = hasPhaseBar
            ? PHASE_BAR_BOTTOM + PHASE_BAR_HEIGHT + CONTROL_GRID_BOTTOM_GAP
            : SINGLE_GRID_BOTTOM;
        return {
            backgroundColor: 'transparent',
            animation: false,
            grid: [
                { left: leftMargin, right: rightMargin, top: topMargin, bottom: singleBottom },
                ...(hasPhaseBar
                    ? [{ left: leftMargin, right: rightMargin, bottom: PHASE_BAR_BOTTOM, height: PHASE_BAR_HEIGHT }]
                    : []),
            ],
            tooltip: {
                trigger: 'axis',
                borderWidth: 1,
                borderColor: 'rgba(0,0,0,0.08)',
                extraCssText: 'box-shadow: none;',
                axisPointer: { type: 'cross', lineStyle: { color: CHART_COLORS.axisPointerLine, width: 1 } },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter: (params: any) => {
                    const timeSec = params[0]?.axisValue ?? 0;
                    let html = `<div style="font-weight:500;color:${CHART_COLORS.tooltipTimeColor};margin-bottom:6px">${fmtSec(timeSec)}</div>`;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    params.forEach((p: any) => {
                        if (p.seriesName === 'BT Target')
                            html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.btTarget}"></div>Target BT: <span>${p.value[1]?.toFixed(1)}${unitLabel}</span></div>`;
                        if (p.seriesName === 'BT Actual')
                            html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.btActual}"></div>Bean Temp: <span>${p.value[1]?.toFixed(1)}${unitLabel}</span></div>`;
                        if (p.seriesName === 'ET Actual' && showET)
                            html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.etActual}"></div>Env Temp: <span>${p.value[1]?.toFixed(1)}${unitLabel}</span></div>`;
                        if (p.seriesName === 'RoR' && showRoR)
                            html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.rorActual}"></div>RoR: <span>${p.value[1]?.toFixed(1)}${rorUnit}</span></div>`;
                    });
                    return html;
                },
            },
            xAxis: [
                {
                    gridIndex: 0,
                    type: 'value',
                    name: hasPhaseBar ? undefined : 'Time (min)',
                    nameLocation: 'middle',
                    nameGap: 16,
                    nameTextStyle: axisNameStyle,
                    min: xMin,
                    max: xMax,
                    axisLabel: hasPhaseBar
                        ? { show: false }
                        : { formatter: (v: number) => fmtSec(v), ...axisLabelStyle },
                    axisTick: hasPhaseBar ? { show: false } : undefined,
                    interval: 60,
                    splitNumber: 15,
                    splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 1 } },
                },
                ...(hasPhaseBar
                    ? [
                          {
                              gridIndex: 1,
                              type: 'value' as const,
                              min: xMin,
                              max: xMax,
                              axisLabel: { formatter: fmtSec, ...axisLabelStyle },
                              axisTick: { show: false },
                              axisLine: { show: false },
                              splitLine: { show: false },
                              interval: 60,
                              splitNumber: 15,
                          },
                      ]
                    : []),
            ],
            yAxis: [
                {
                    gridIndex: 0,
                    type: 'value',
                    name: `Temperature (${unitLabel})`,
                    nameLocation: 'middle',
                    nameGap: Y_AXIS_NAME_GAP,
                    nameTextStyle: axisNameStyle,
                    axisLine: { onZero: false },
                    axisLabel: axisLabelStyle,
                    splitLine: { show: true, lineStyle: { color: colors.gridLine } },
                    min: temperatureUnit === 'F' ? 122 : 50,
                    max: temperatureUnit === 'F' ? 482 : 250,
                    interval: 20,
                },
                {
                    gridIndex: 0,
                    type: 'value',
                    name: `RoR (${rorUnit})`,
                    nameLocation: 'middle',
                    nameGap: Y_AXIS_NAME_GAP,
                    nameTextStyle: axisNameStyle,
                    position: 'right',
                    axisLine: { onZero: false },
                    axisLabel: rightYAxisLabel,
                    splitLine: { show: false },
                    min: ROR_Y_MIN,
                    max: ROR_Y_MAX,
                    interval: 20,
                },
                ...(hasPhaseBar
                    ? [
                          {
                              gridIndex: 1,
                              type: 'value' as const,
                              min: 0,
                              max: 1,
                              show: false,
                          },
                      ]
                    : []),
            ],
            series: [...tempSeries, ...(hasPhaseBar ? [buildPhaseSeries(1, 2)] : [])],
            dataZoom: [
                {
                    type: 'inside',
                    xAxisIndex: 0,
                    zoomOnMouseWheel: true,
                    moveOnMouseMove: false,
                    moveOnMouseWheel: true,
                },
            ],
        };
    }, [
        xs,
        btTarget,
        btActual,
        etActual,
        rorActual,
        eventMarkers,
        turningPoints,
        temperatureUnit,
        showET,
        showTargetCurve,
        showRoR,
        showRoRET,
        rorEtActual,
        controlData,
        phaseSegments,
        resolvedTheme,
    ]);

    // 옵션 적용 — controlData/phaseBar 유무가 바뀌면 grid/axis 구조가 달라지므로 notMerge로 완전 교체
    const prevHasControlData = useRef(!!controlData);
    const prevHasPhaseBar = useRef(phaseSegments.length > 0);
    useEffect(() => {
        const chart = chartInstanceRef.current;
        if (!chart) return;
        const hasPhaseBar = phaseSegments.length > 0;
        const structureChanged =
            prevHasControlData.current !== !!controlData || prevHasPhaseBar.current !== hasPhaseBar;
        prevHasControlData.current = !!controlData;
        prevHasPhaseBar.current = hasPhaseBar;
        chart.setOption(option, {
            notMerge: structureChanged,
            lazyUpdate: !structureChanged,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [option]);

    // 마우스 호버
    useEffect(() => {
        const chart = chartInstanceRef.current;
        if (!chart || !onCursorIdx) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // ── 마커 드래그 (chart.getZr()로 마크라인 핸들 감지) ──────────
    useEffect(() => {
        const chart = chartInstanceRef.current;
        if (!chart || !onEventMarkerDrag) return;

        const zr = chart.getZr();
        if (!zr) return;

        const handleZrPointerDown = (e: Record<string, unknown>) => {
            if (!chart) return;
            const evt = e.event as MouseEvent | undefined;
            const mx = evt?.offsetX ?? (e.offsetX as number);
            if (mx == null) return;
            const yMid = (chart.convertToPixel({ yAxisIndex: 0 }, 150) as number) ?? 200;
            for (const marker of eventMarkers) {
                const pixel = chart.convertToPixel({ xAxisIndex: 0 }, [marker.timeSec, yMid]);
                if (pixel == null) continue;
                const px = Array.isArray(pixel) ? pixel[0] : pixel;
                const dist = Math.abs(mx - px);
                if (dist <= PIXEL_THRESHOLD) {
                    dragStateRef.current = {
                        active: true,
                        eventName: marker.event,
                        startX: mx,
                        startTimeSec: marker.timeSec,
                    };
                    break;
                }
            }
        };

        const handleZrPointerMove = (e: Record<string, unknown>) => {
            const ds = dragStateRef.current;
            if (!ds || !ds.active || !chart) return;
            const evt = e.event as MouseEvent | undefined;
            const mx = evt?.offsetX ?? (e.offsetX as number);
            const my = evt?.offsetY ?? (e.offsetY as number);
            if (mx == null) return;
            const point = chart.convertFromPixel({ xAxisIndex: 0 }, [mx, my]);
            if (!point) return;
            const xVal = Array.isArray(point) ? point[0] : point;
            const clamped = Math.max(0, Math.round(xVal));
            if (clamped !== ds.startTimeSec) {
                onEventMarkerDrag(ds.eventName, clamped);
                dragStateRef.current = { ...ds, startTimeSec: clamped };
            }
        };

        const handleZrPointerUp = () => {
            if (dragStateRef.current) {
                dragStateRef.current = null;
            }
        };

        zr.on('mousedown', handleZrPointerDown);
        zr.on('mousemove', handleZrPointerMove);
        zr.on('mouseup', handleZrPointerUp);

        return () => {
            zr.off('mousedown', handleZrPointerDown);
            zr.off('mousemove', handleZrPointerMove);
            zr.off('mouseup', handleZrPointerUp);
        };
    }, [eventMarkers, onEventMarkerDrag]);

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
                            <div style={{ width: 16, height: 2, background: color }} />
                            <span className="text-[11px] text-muted tracking-[0.14px]">{label}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
