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
    CONTROL_GRID_BOTTOM_GAP,
    CONTROL_GRID_TOP,
    CONTROL_GRID_TOP_WITH_PHASE,
    getResolvedChartColors,
    PHASE_BAR_BOTTOM,
    PHASE_BAR_FONT_FAMILY,
    PHASE_BAR_FONT_SIZE,
    PHASE_BAR_FONT_SIZE_NARROW,
    PHASE_BAR_FONT_WEIGHT,
    PHASE_BAR_HEIGHT,
    PHASE_BAR_NARROW_THRESHOLD,
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

        const unitLabel = temperatureUnit === 'C' ? '℃' : '℉';
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

        // Charge / NOW: 세로 markLine (가이드) — 항상
        // 이벤트 / TP: eventMarkerStyle 에 따라 line | point
        const usePointMarkers = eventMarkerStyle === 'point';
        const guideMarkLines: object[] = [];
        const controlGuideMarkLines: object[] = [];
        // Charge 라인은 실제 charge 이후에만 (pre-charge 구간에서는 숨김)
        if (charged && xMin <= 0 && xMax >= 0) {
            guideMarkLines.push({
                xAxis: 0,
                lineStyle: {
                    color: colors.phaseLines,
                    width: 1.5,
                    type: 'solid' as const,
                    opacity: 1,
                },
                label: {
                    show: true,
                    position: 'insideEndTop' as const,
                    formatter: 'Charge',
                    color: colors.axisLabel,
                    fontSize: 10,
                    fontWeight: 600,
                },
            });
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
        if (Number.isFinite(currentTimeSec) && currentTimeSec >= xMin && currentTimeSec <= xMax) {
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
                formatter: `${m.event}  ${m.timeStr}  ${m.temp}`,
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
                formatter: `TP  ${fmtSec(tp.timeSec)}  ${toDisplayTemp(tp.temp, temperatureUnit).toFixed(1)}${unitLabel}`,
                color: colors.tp,
                fontSize: 11,
                fontWeight: 700,
            },
        }));

        // ── point style: 작은 점 + 텍스트만 (박스/배경 없음) ────────────────
        const buildPointLabel = (color: string, title: string, timeStr: string, tempStr: string) => ({
            show: true,
            position: 'top' as const,
            distance: 5,
            formatter: `${title}  ${timeStr}  ${tempStr}`,
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
                              label: buildPointLabel(
                                  m.color,
                                  m.event,
                                  m.timeStr,
                                  m.temp || `${y.toFixed(1)}${unitLabel}`,
                              ),
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
                          label: buildPointLabel(colors.tp, 'TP', fmtSec(tp.timeSec), tempStr),
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
                    areaStyle: { color: colors.btTarget, opacity: 0.06 },
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

                // 단계별 배경 박스 생성 (phase bar 텍스트 색은 theme-resolved)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const children: any[] = [
                    {
                        type: 'rect',
                        shape: { x: startPx, y, width, height: h },
                        style: {
                            fill: color,
                            stroke: colors.phaseBarStroke,
                            lineWidth: PHASE_BAR_STROKE_WIDTH,
                        },
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
                            fill: colors.phaseBarName,
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
                            x: (startPx + endPx) / 2,
                            y: y + h / 2,
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
                          // name: `Temperature (${unitLabel})`,
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
                          // name: `RoR (${rorUnit})`,
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
                          min: 0,
                          max: 1,
                          show: false,
                      },
                      {
                          gridIndex: 2,
                          type: 'value',
                          // name: 'Drum (rpm)',
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
                          // name: 'Power / Speed (%)',
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
                          // name: `Temperature (${unitLabel})`,
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
                          // name: `RoR (${rorUnit})`,
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
                          // name: 'Drum (rpm)',
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
                          // name: 'Power / Speed (%)',
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
                        xAxisIndex: hasPhaseBar ? 2 : 1,
                        yAxisIndex: hasPhaseBar ? 3 : 2,
                        data: cxs.map((x, i) => [x, drumTemp[i]]),
                        lineStyle: { color: colors.controlDrum, width: 1.5 },
                        ...hoverPoint,
                        smooth: 0.3,
                        // NOW / Charge 선을 control grid에도 동일 x로 표시 (라벨은 temp chart만)
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
                        xAxisIndex: hasPhaseBar ? 2 : 1,
                        yAxisIndex: hasPhaseBar ? 4 : 3,
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
                        xAxisIndex: hasPhaseBar ? 2 : 1,
                        yAxisIndex: hasPhaseBar ? 4 : 3,
                        data: cxs.map((x, i) => [x, fanSpeed[i]]),
                        lineStyle: { color: colors.controlFan, width: 1.5 },
                        ...hoverPoint,
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
                    // name: hasPhaseBar ? undefined : 'Time (min)',
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
                    // name: `Temperature (${unitLabel})`,
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
                    // name: `RoR (${rorUnit})`,
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
                    xAxisIndex: hasPhaseBar ? [0, 1] : [0],
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
