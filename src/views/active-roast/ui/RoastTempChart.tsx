import type { EventMarkerStyle, PhaseSegment, TemperatureUnit, TurningPoint } from '@features/active-roast';
import {
    AXIS_LABEL_FONT,
    CHART_COLORS,
    CHART_GRID_LEFT,
    CHART_GRID_RIGHT,
    CHART_GRID_RIGHT_WITH_ROR,
    CHART_GRID_TOP,
    CONTROL_COLORS,
    CONTROL_GRID_BOTTOM,
    CONTROL_GRID_TOP,
    getResolvedChartColors,
    PHASE_BAR_FONT_FAMILY,
    PHASE_BAR_FONT_SIZE,
    PHASE_BAR_FONT_SIZE_NARROW,
    PHASE_BAR_FONT_WEIGHT,
    PHASE_BAR_HEIGHT,
    PHASE_BAR_NARROW_THRESHOLD,
    PHASE_BAR_STROKE_WIDTH,
    PHASE_BAR_TEXT_INSET,
    PHASE_BAR_WIDE_THRESHOLD,
    ROR_Y_MAX,
    ROR_Y_MIN,
    SINGLE_GRID_BOTTOM,
    TEMP_GRID_HEIGHT,
    TEMP_Y_INTERVAL,
    TEMP_Y_MAX_C,
    TEMP_Y_MIN_C,
    Y_AXIS_NAME_GAP,
} from '@features/active-roast/lib/chart-config';
import { toDisplayTemp } from '@features/active-roast/lib/temperature';
import { useThemeStore } from '@shared/store/theme';
import type { EChartsOption } from 'echarts';
import * as echarts from 'echarts';
import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
export interface RoastEventMarker {
    timeSec: number;
    event: string;
    color: string;
    timeStr: string;
    temp: string;
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
    /** Charge 이후일 때만 t=0 Charge 가이드 라인 표시 */
    charged?: boolean;
    /** line = 세로 markLine | point = 곡선 위 markPoint */
    eventMarkerStyle?: EventMarkerStyle;
    eventMarkers: RoastEventMarker[];
    turningPoints?: TurningPoint[];
    temperatureUnit?: TemperatureUnit;
    height: number;
    onCursorIdx?: (idx: number | null) => void;
    onEventMarkerDrag?: (event: string, newTimeSec: number) => void;
    showET?: boolean;
    showTargetCurve?: boolean;
    /** 타깃 프로파일 전용 x/bt — live xs와 분리 (전체 프로파일 곡선 + area 배경) */
    targetXs?: number[];
    targetBt?: (number | null)[];
    showRoR?: boolean;
    showRoRET?: boolean;
    rorEtActual?: (number | null)[];
    controlData?: ControlData;
    phaseSegments?: PhaseSegment[];
    tempMinC?: number;
    tempMaxC?: number;
    rorYMin?: number;
    rorYMax?: number;
}

const fmtSec = (v: number) => {
    const sign = v < 0 ? '-' : '';
    const abs = Math.abs(v);
    const m = Math.floor(abs / 60);
    const s = Math.floor(abs % 60);
    return `${sign}${m}:${String(s).padStart(2, '0')}`;
};

/** 시간축에서 가장 가까운 BT 표시값 조회 */
const nearestBtAt = (xs: number[], btActual: (number | null)[], timeSec: number): number | null => {
    if (!xs.length) return null;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < xs.length; i++) {
        if (btActual[i] == null) continue;
        const d = Math.abs(xs[i] - timeSec);
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }
    return bestIdx >= 0 ? (btActual[bestIdx] as number) : null;
};

export const RoastTempChart: React.FC<Props> = ({
    xs,
    btTarget,
    btActual,
    etActual,
    rorActual,
    currentTimeSec,
    charged = false,
    eventMarkerStyle = 'point',
    eventMarkers,
    turningPoints = [],
    temperatureUnit = 'C',
    height,
    onCursorIdx,
    onEventMarkerDrag,
    showET = true,
    showTargetCurve = true,
    targetXs,
    targetBt,
    showRoR = true,
    showRoRET = false,
    rorEtActual = [],
    controlData,
    phaseSegments = [],
    tempMinC = TEMP_Y_MIN_C,
    tempMaxC = TEMP_Y_MAX_C,
    rorYMin = ROR_Y_MIN,
    rorYMax = ROR_Y_MAX,
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

    const lastChartSizeRef = useRef({ w: 0, h: 0 });

    // ECharts 초기화
    useEffect((): (() => void) | undefined => {
        const container = chartRef.current;
        if (!container) return undefined;

        const chart = echarts.init(container, undefined, {
            renderer: 'canvas',
            useDirtyRect: false,
        });
        chartInstanceRef.current = chart;

        const resizeObserver = new ResizeObserver(() => {
            const w = container.offsetWidth;
            const h = container.offsetHeight;
            if (w <= 0 || h <= 0) return;
            const last = lastChartSizeRef.current;
            if (last.w === w && last.h === h) return;
            lastChartSizeRef.current = { w, h };
            chart.resize();
        });
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

        // formatTemp와 동일: °+C/F (℃/℉ 단일 글리프는 monospace에서 깨짐)
        const unitLabel = temperatureUnit === 'C' ? '°C' : '°F';
        const rorUnit = temperatureUnit === 'C' ? '℃/min' : '℉/min';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const formatAxisTooltip = (params: any) => {
            const timeSec = params[0]?.axisValue ?? 0;
            let html = `<div style="font-weight:500;color:${CHART_COLORS.tooltipTimeColor};margin-bottom:6px">${fmtSec(timeSec)}</div>`;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            params.forEach((p: any) => {
                const y = p.value?.[1];
                if (p.seriesName === 'BT Target' && y != null)
                    html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.btTarget}"></div>Target BT: <span>${y.toFixed(1)}${unitLabel}</span></div>`;
                if (p.seriesName === 'BT Actual' && y != null)
                    html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.btActual}"></div>Bean Temp: <span>${y.toFixed(1)}${unitLabel}</span></div>`;
                if (p.seriesName === 'ET Actual' && showET && y != null)
                    html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.etActual}"></div>Env Temp: <span>${y.toFixed(1)}${unitLabel}</span></div>`;
                if (p.seriesName === 'RoR' && showRoR && y != null)
                    html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.rorActual}"></div>RoR: <span>${y.toFixed(1)}${rorUnit}</span></div>`;
                if (p.seriesName === 'ET RoR' && showRoRET && y != null)
                    html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.etActual}"></div>ET RoR: <span>${y.toFixed(1)}${rorUnit}</span></div>`;
                if (controlData && p.seriesName === 'Drum' && y != null)
                    html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.controlDrum}"></div>Drum: <span>${y} RPM</span></div>`;
                if (controlData && p.seriesName === 'Heat' && y != null)
                    html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.controlHeat}"></div>Heat: <span>${y}%</span></div>`;
                if (controlData && p.seriesName === 'Fan' && y != null)
                    html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.controlFan}"></div>Fan: <span>${y}%</span></div>`;
            });
            return html;
        };

        // 커피 로스팅 차트에 최적화된 스무딩 설정
        // - BT(Bean Temp): 0.4 → 실측 느낌 유지, 과한 곡선화 방지
        // - ET(Environment Temp): 0.35 → BT보다 약간 덜 휘게
        // - RoR(Rate of Rise): 0.25 → 센서 노이즈 많아서 상대적으로 더 부드럽게
        // - smoothMonotone 'x' → 시간축 방향으로만 스무딩 (역행 방지)
        // - sampling 'lttb' → Largest-Triangle-Three-Buckets 알고리즘 (성능 + 품질)
        const getSmoothConfig = (strength: number = 0.4) => ({
            smooth: strength,
            smoothMonotone: 'x' as const,
            sampling: 'lttb' as const,
        });

        // axis hover 시 찍히는 포인트 — 확대 없음
        const hoverPoint = {
            showSymbol: false,
            symbol: 'circle' as const,
            symbolSize: 6,
            emphasis: { scale: false },
        };

        const xMin = xs[0] ?? 0;
        const xMax = xs[xs.length - 1] ?? 1200;

        // Charge: eventMarkers 경유 → eventMarkerStyle(point|line)과 동일 처리
        // NOW: 세로 markLine 가이드 (항상)
        // 이벤트 / TP: eventMarkerStyle 에 따라 line | point
        const usePointMarkers = eventMarkerStyle === 'point';
        const guideMarkLines: object[] = [];
        const controlGuideMarkLines: object[] = [];
        // Control chart 전용: charge 기준 t=0 무음 가이드 (라벨 없음)
        if (charged && xMin <= 0 && xMax >= 0) {
            controlGuideMarkLines.push({
                xAxis: 0,
                lineStyle: {
                    color: colors.phaseLines,
                    width: 1.5,
                    type: 'solid' as const,
                    opacity: 1,
                },
                label: { show: false },
            });
        }
        if (charged && Number.isFinite(currentTimeSec) && currentTimeSec >= xMin && currentTimeSec <= xMax) {
            guideMarkLines.push({
                xAxis: currentTimeSec,
                lineStyle: {
                    color: colors.currentTimeLine,
                    width: 1.5,
                    type: 'dashed' as const,
                    opacity: 1,
                },
                label: {
                    show: true,
                    position: 'insideEndTop' as const,
                    formatter: 'NOW',
                    color: colors.nowLabel,
                    fontSize: 10,
                    fontWeight: 700,
                },
            });
            controlGuideMarkLines.push({
                xAxis: currentTimeSec,
                lineStyle: {
                    color: colors.currentTimeLine,
                    width: 1.5,
                    type: 'dashed' as const,
                    opacity: 1,
                },
                label: { show: false },
            });
        }

        // ── line style: 세로 markLine + start 라벨 ──────────────────────────
        // Charge는 t=0 고정 → 시간 생략 (event + temp만)
        const eventLabelText = (event: string, timeStr: string, temp: string) =>
            event === 'Charge' ? `${event} ${temp}` : `${event} ${timeStr} ${temp}`;

        const eventMarkLines = eventMarkers.map((m) => ({
            xAxis: m.timeSec,
            lineStyle: {
                color: m.color,
                width: 1.5,
                type: 'solid' as const,
                opacity: 1,
            },
            label: {
                show: true,
                position: 'start' as const,
                formatter: eventLabelText(m.event, m.timeStr, m.temp),
                color: m.color,
                fontSize: 11,
                fontWeight: 700,
            },
        }));

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
                position: 'start' as const,
                formatter: `TP ${fmtSec(tp.timeSec)} ${toDisplayTemp(tp.temp, temperatureUnit).toFixed(1)}${unitLabel}`,
                color: colors.tp,
                fontSize: 11,
                fontWeight: 700,
            },
        }));

        // ── point style: 작은 점 + 텍스트만 (박스/배경 없음) ────────────────
        const buildPointLabel = (color: string, text: string) => ({
            show: true,
            position: 'top' as const,
            distance: 5,
            formatter: text,
            fontSize: 10,
            fontWeight: 600 as const,
            fontFamily: 'monospace',
            color,
            backgroundColor: 'transparent',
            borderWidth: 0,
            padding: 0,
        });

        const markPointData = usePointMarkers
            ? [
                  ...eventMarkers
                      .map((m) => {
                          const y = nearestBtAt(xs, btActual, m.timeSec);
                          if (y == null) return null;
                          const tempStr = m.temp || `${y.toFixed(1)}${unitLabel}`;
                          return {
                              name: m.event,
                              coord: [m.timeSec, y] as [number, number],
                              symbol: 'circle' as const,
                              symbolSize: 5,
                              itemStyle: {
                                  color: m.color,
                                  borderColor: colors.markerLabelColor,
                                  borderWidth: 1,
                              },
                              label: buildPointLabel(m.color, eventLabelText(m.event, m.timeStr, tempStr)),
                          };
                      })
                      .filter(Boolean),
                  ...turningPoints.map((tp) => {
                      const yDisp = nearestBtAt(xs, btActual, tp.timeSec) ?? toDisplayTemp(tp.temp, temperatureUnit);
                      const tempStr = `${toDisplayTemp(tp.temp, temperatureUnit).toFixed(1)}${unitLabel}`;
                      return {
                          name: 'TP',
                          coord: [tp.timeSec, yDisp] as [number, number],
                          symbol: 'circle' as const,
                          symbolSize: 5,
                          itemStyle: {
                              color: colors.tp,
                              borderColor: colors.markerLabelColor,
                              borderWidth: 1,
                          },
                          label: buildPointLabel(colors.tp, `TP ${fmtSec(tp.timeSec)} ${tempStr}`),
                      };
                  }),
              ]
            : [];

        const allMarkLines = usePointMarkers ? guideMarkLines : [...guideMarkLines, ...eventMarkLines, ...tpMarkLines];

        const hasRightYAxis = showRoR || !!controlData;
        const rightMargin = hasRightYAxis ? CHART_GRID_RIGHT_WITH_ROR : CHART_GRID_RIGHT;
        const leftMargin = CHART_GRID_LEFT;
        const topMargin = CHART_GRID_TOP;

        const tempSeries = [
            showTargetCurve &&
                targetXs?.length &&
                targetBt?.length && {
                    name: 'BT Target',
                    type: 'line',
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    z: 1,
                    data: targetXs.map((x, i) => [x, targetBt[i] ?? null]),
                    lineStyle: { color: colors.btTarget, width: 1.5, type: 'dashed', opacity: 0.55 },
                    ...hoverPoint,
                    smooth: false,
                },
            {
                name: 'BT Actual',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                z: 2,
                data: xs.map((x, i) => [x, btActual[i]]),
                lineStyle: { color: colors.btActual, width: 2 },
                ...hoverPoint,
                ...getSmoothConfig(0.4),
                markLine:
                    allMarkLines.length > 0
                        ? {
                              silent: usePointMarkers,
                              symbol: ['none', 'none'],
                              symbolSize: 0,
                              data: allMarkLines,
                          }
                        : undefined,
                markPoint:
                    markPointData.length > 0
                        ? {
                              silent: false,
                              data: markPointData as object[],
                              animation: false,
                          }
                        : undefined,
            },
            showET && {
                name: 'ET Actual',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                z: 2,
                data: xs.map((x, i) => [x, etActual[i]]),
                lineStyle: { color: colors.etActual, width: 1.6 },
                ...hoverPoint,
                ...getSmoothConfig(0.35),
            },
            showRoR && {
                name: 'RoR',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 1,
                data: xs.map((x, i) => [x, rorActual[i]]),
                lineStyle: { color: colors.rorActual, width: 1.3 },
                ...hoverPoint,
                ...getSmoothConfig(0.25),
            },
            showRoR &&
                showRoRET && {
                    name: 'ET RoR',
                    type: 'line',
                    xAxisIndex: 0,
                    yAxisIndex: 1,
                    data: xs.map((x, i) => [x, rorEtActual[i] ?? null]),
                    lineStyle: { color: colors.etActual, width: 1.0, type: 'dashed' },
                    ...hoverPoint,
                    ...getSmoothConfig(0.25),
                },
        ].filter(Boolean) as object[];

        // ── Phase bar (온도 plot 하단 오버레이) ───────────────────────────────
        // 별도 grid 없이 temp grid(x0/y0) 하단에 custom series로 그린다.
        // dataZoom/zoom 시 x는 축과 동기화, y는 coordSys 하단 고정 높이.
        const hasPhaseBar = phaseSegments.length > 0;
        // y=0이 temp 축 min(기본 50°C) 밖일 수 있어 x 변환용 mid Y 사용
        const phaseCoordY = (toDisplayTemp(tempMinC, temperatureUnit) + toDisplayTemp(tempMaxC, temperatureUnit)) / 2;

        const buildPhaseSeries = () => ({
            type: 'custom' as const,
            xAxisIndex: 0,
            yAxisIndex: 0,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            renderItem: (params: any, api: any) => {
                const startPx = api.coord([api.value(0), phaseCoordY])[0] as number;
                const endPx = api.coord([api.value(1), phaseCoordY])[0] as number;
                const { x: csX, y: csY, width: csW, height: csH } = params.coordSys;
                const barY = csY + csH - PHASE_BAR_HEIGHT;
                const clipped = echarts.graphic.clipRectByRect(
                    {
                        x: startPx,
                        y: barY,
                        width: Math.max(0, endPx - startPx),
                        height: PHASE_BAR_HEIGHT,
                    },
                    { x: csX, y: csY, width: csW, height: csH },
                );
                if (!clipped) return;

                const durSec = api.value(2) as number;
                const pct = api.value(3) as number;
                const color = api.value(4) as string;
                const name = api.value(5) as string;
                const durMin = Math.floor(durSec / 60);
                const durS = String(durSec % 60).padStart(2, '0');
                const durLabel = `${durMin}:${durS}  ${pct}%`;
                const { x, y, width, height: h } = clipped;
                const textY = y + h / 2;

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const children: any[] = [
                    {
                        type: 'rect',
                        shape: clipped,
                        style: {
                            fill: color,
                            stroke: colors.phaseBarStroke,
                            lineWidth: PHASE_BAR_STROKE_WIDTH,
                        },
                        silent: true,
                    },
                ];

                // width > WIDE: 단계명 좌 + 시간 우 / NARROW~WIDE: 시간만 중앙 / ≤NARROW: 생략
                if (width > PHASE_BAR_WIDE_THRESHOLD) {
                    children.push({
                        type: 'text',
                        style: {
                            text: name,
                            x: x + PHASE_BAR_TEXT_INSET,
                            y: textY,
                            fontSize: PHASE_BAR_FONT_SIZE,
                            fontFamily: PHASE_BAR_FONT_FAMILY,
                            fontWeight: PHASE_BAR_FONT_WEIGHT,
                            fill: colors.phaseBarName,
                            textVerticalAlign: 'middle',
                        },
                        silent: true,
                    });
                    children.push({
                        type: 'text',
                        style: {
                            text: durLabel,
                            x: x + width - PHASE_BAR_TEXT_INSET,
                            y: textY,
                            fontSize: PHASE_BAR_FONT_SIZE,
                            fontFamily: PHASE_BAR_FONT_FAMILY,
                            fill: colors.phaseBarDuration,
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
                            x: x + width / 2,
                            y: textY,
                            fontSize: PHASE_BAR_FONT_SIZE_NARROW,
                            fontFamily: PHASE_BAR_FONT_FAMILY,
                            fill: colors.phaseBarDuration,
                            textAlign: 'center',
                            textVerticalAlign: 'middle',
                        },
                        silent: true,
                    });
                }

                return { type: 'group', children };
            },
            // [startSec, endSec, durationSec, percentage, color, name]
            data: phaseSegments.map((seg) => [seg.startSec, seg.endSec, seg.durationSec, seg.pct, seg.color, seg.name]),
            z: 10,
            silent: true,
        });

        if (controlData) {
            const { xs: cxs, drumTemp, heatPower, fanSpeed } = controlData;
            // Grid: [0] Temp/RoR (+ phase overlay) · [1] Drum/Heat/Fan
            return {
                backgroundColor: 'transparent',
                animation: false,
                axisPointer: { link: [{ xAxisIndex: [0, 1] }], label: { show: false } },
                grid: [
                    { left: leftMargin, right: rightMargin, top: topMargin, height: TEMP_GRID_HEIGHT },
                    { left: leftMargin, right: rightMargin, top: CONTROL_GRID_TOP, bottom: CONTROL_GRID_BOTTOM },
                ],
                xAxis: [
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
                        type: 'value' as const,
                        min: xMin,
                        max: xMax,
                        axisLabel: { formatter: fmtSec, ...axisLabelStyle },
                        axisTick: { show: false },
                        interval: 60,
                        splitNumber: 15,
                        splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 0.5 } },
                    },
                ] as EChartsOption['xAxis'],
                yAxis: [
                    {
                        gridIndex: 0,
                        type: 'value',
                        nameLocation: 'middle',
                        nameGap: Y_AXIS_NAME_GAP,
                        nameTextStyle: axisNameStyle,
                        axisLine: { onZero: false },
                        axisLabel: axisLabelStyle,
                        splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 0.5 } },
                        minorTick: { show: true, splitNumber: 2 },
                        minorSplitLine: { show: true, lineStyle: { color: colors.gridLineMinor, width: 0.5 } },
                        min: toDisplayTemp(tempMinC, temperatureUnit),
                        max: toDisplayTemp(tempMaxC, temperatureUnit),
                        interval: TEMP_Y_INTERVAL,
                    },
                    {
                        gridIndex: 0,
                        type: 'value',
                        nameLocation: 'middle',
                        nameGap: Y_AXIS_NAME_GAP,
                        nameTextStyle: axisNameStyle,
                        position: 'right',
                        axisLine: { onZero: false },
                        axisLabel: rightYAxisLabel,
                        splitLine: { show: false },
                        min: rorYMin,
                        max: rorYMax,
                        interval: 20,
                    },
                    {
                        gridIndex: 1,
                        type: 'value',
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
                ] as EChartsOption['yAxis'],
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: colors.tooltipBg,
                    borderWidth: 1,
                    borderColor: colors.tooltipBorder,
                    extraCssText: 'box-shadow: none;',
                    axisPointer: { type: 'line', lineStyle: { color: colors.axisPointerLine, width: 1 } },
                    formatter: formatAxisTooltip,
                },
                series: [
                    ...tempSeries,
                    {
                        name: 'Drum',
                        type: 'line',
                        color: colors.controlDrum,
                        xAxisIndex: 1,
                        yAxisIndex: 2,
                        data: cxs.map((x, i) => [x, drumTemp[i]]),
                        lineStyle: { color: colors.controlDrum, width: 1.5 },
                        ...hoverPoint,
                        smooth: 0.3,
                        markLine:
                            controlGuideMarkLines.length > 0
                                ? {
                                      silent: true,
                                      symbol: ['none', 'none'],
                                      symbolSize: 0,
                                      data: controlGuideMarkLines,
                                  }
                                : undefined,
                    },
                    {
                        name: 'Heat',
                        type: 'line',
                        color: colors.controlHeat,
                        xAxisIndex: 1,
                        yAxisIndex: 3,
                        data: cxs.map((x, i) => [x, heatPower[i]]),
                        lineStyle: { color: colors.controlHeat, width: 1.5 },
                        ...hoverPoint,
                        step: 'end',
                        smooth: false,
                    },
                    {
                        name: 'Fan',
                        type: 'line',
                        color: colors.controlFan,
                        xAxisIndex: 1,
                        yAxisIndex: 3,
                        data: cxs.map((x, i) => [x, fanSpeed[i]]),
                        lineStyle: { color: colors.controlFan, width: 1.5 },
                        ...hoverPoint,
                        step: 'end',
                        smooth: false,
                    },
                    ...(hasPhaseBar ? [buildPhaseSeries()] : []),
                ],
                dataZoom: [
                    {
                        type: 'inside',
                        xAxisIndex: [0, 1],
                        zoomOnMouseWheel: true,
                        moveOnMouseMove: false,
                        moveOnMouseWheel: true,
                    },
                ],
            };
        }

        return {
            backgroundColor: 'transparent',
            animation: false,
            grid: [{ left: leftMargin, right: rightMargin, top: topMargin, bottom: SINGLE_GRID_BOTTOM }],
            tooltip: {
                trigger: 'axis',
                backgroundColor: colors.tooltipBg,
                borderWidth: 1,
                borderColor: colors.tooltipBorder,
                extraCssText: 'box-shadow: none;',
                axisPointer: { type: 'cross', lineStyle: { color: colors.axisPointerLine, width: 1 } },
                formatter: formatAxisTooltip,
            },
            xAxis: [
                {
                    gridIndex: 0,
                    type: 'value',
                    nameLocation: 'middle',
                    nameGap: 16,
                    nameTextStyle: axisNameStyle,
                    min: xMin,
                    max: xMax,
                    axisLabel: { formatter: (v: number) => fmtSec(v), ...axisLabelStyle },
                    interval: 60,
                    splitNumber: 15,
                    splitLine: { show: true, lineStyle: { color: colors.gridLine, width: 1 } },
                },
            ],
            yAxis: [
                {
                    gridIndex: 0,
                    type: 'value',
                    nameLocation: 'middle',
                    nameGap: Y_AXIS_NAME_GAP,
                    nameTextStyle: axisNameStyle,
                    axisLine: { onZero: false },
                    axisLabel: axisLabelStyle,
                    splitLine: { show: true, lineStyle: { color: colors.gridLine } },
                    min: toDisplayTemp(tempMinC, temperatureUnit),
                    max: toDisplayTemp(tempMaxC, temperatureUnit),
                    interval: 20,
                },
                {
                    gridIndex: 0,
                    type: 'value',
                    nameLocation: 'middle',
                    nameGap: Y_AXIS_NAME_GAP,
                    nameTextStyle: axisNameStyle,
                    position: 'right',
                    axisLine: { onZero: false },
                    axisLabel: rightYAxisLabel,
                    splitLine: { show: false },
                    min: rorYMin,
                    max: rorYMax,
                    interval: 20,
                },
            ],
            series: [...tempSeries, ...(hasPhaseBar ? [buildPhaseSeries()] : [])],
            dataZoom: [
                {
                    type: 'inside',
                    xAxisIndex: [0],
                    zoomOnMouseWheel: true,
                    moveOnMouseMove: false,
                    moveOnMouseWheel: true,
                },
            ],
        };
    }, [
        xs,
        btTarget,
        targetXs,
        targetBt,
        btActual,
        etActual,
        rorActual,
        currentTimeSec,
        charged,
        eventMarkerStyle,
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
        tempMinC,
        tempMaxC,
        rorYMin,
        rorYMax,
    ]);

    // 옵션 적용 — controlData/phaseBar/target/eventMarkerStyle 이 바뀌면 notMerge로 완전 교체
    // (phase bar는 grid 구조는 안 바꾸지만 series 유무 토글 시 merge 잔존 방지)
    const prevHasControlData = useRef(!!controlData);
    const prevHasPhaseBar = useRef(phaseSegments.length > 0);
    const prevHasTargetData = useRef(!!(targetXs?.length && targetBt?.length));
    const prevEventMarkerStyle = useRef(eventMarkerStyle);
    useEffect(() => {
        const chart = chartInstanceRef.current;
        if (!chart) return;
        const hasPhaseBar = phaseSegments.length > 0;
        const hasTargetData = !!(targetXs?.length && targetBt?.length);
        const structureChanged =
            prevHasControlData.current !== !!controlData ||
            prevHasPhaseBar.current !== hasPhaseBar ||
            prevHasTargetData.current !== hasTargetData ||
            prevEventMarkerStyle.current !== eventMarkerStyle;
        prevHasControlData.current = !!controlData;
        prevHasPhaseBar.current = hasPhaseBar;
        prevHasTargetData.current = hasTargetData;
        prevEventMarkerStyle.current = eventMarkerStyle;
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
        const handleGlobalOut = () => onCursorIdx(null);
        chart.on('globalout', handleGlobalOut);
        return () => {
            chart.off('mousemove', handleMouseMove);
            chart.off('globalout', handleGlobalOut);
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
                // Charge는 시간 원점(t=0) — 드래그로 옮기지 않음
                if (marker.event === 'Charge') continue;
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
