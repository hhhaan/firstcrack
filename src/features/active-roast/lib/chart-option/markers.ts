import type { EventMarkerStyle, TemperatureUnit, TurningPoint } from '@features/active-roast';
import { isControlEvent } from '@features/active-roast/lib/chart-config';
import { formatTemp, toDisplayTemp } from '@features/active-roast/lib/temperature';
import { buildTargetDeltaMarkPoint } from './target-delta-label';
import type { ResolvedChartColors, RoastEventMarker } from './types';

/** 시간축에서 가장 가까운 BT 표시값 조회 */
export const nearestBtAt = (xs: number[], btActual: (number | null)[], timeSec: number): number | null => {
    if (!xs.length) return null;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < xs.length; i++) {
        if (!Number.isFinite(xs[i]) || !Number.isFinite(btActual[i])) continue;
        const d = Math.abs(xs[i] - timeSec);
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }
    return bestIdx >= 0 ? btActual[bestIdx] : null;
};

const formatMarkerTime = (timeSec: number) => {
    const sec = Math.max(0, Math.floor(timeSec));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};

export const eventLabelText = (event: string, timeSec: number, temp: string, note?: string) => {
    const name = event === 'Note' ? note?.trim() || event : event === 'Heater' && note ? `${event} → ${note}` : event;
    return `[${formatMarkerTime(timeSec)}] ${name} @ ${temp || '—'}`;
};

export const MARKER_LABEL_STACK_PX = 14;
export const MARKER_LABEL_DISTANCE_PX = 6;

export interface MarkerLabelGeometry {
    x: number;
    y: number;
    align: 'left' | 'right';
    text: string;
    rank: number;
}

/** Exact curve-label geometry shared with pointer hit-testing. Coordinates are CSS pixels. */
export const getMarkerLabelGeometry = ({
    anchorX,
    anchorY,
    timeSec,
    xMin,
    xMax,
    rank,
    text,
}: {
    anchorX: number;
    anchorY: number;
    timeSec: number;
    xMin: number;
    xMax: number;
    rank: number;
    text: string;
}): MarkerLabelGeometry => {
    const right = xMax > xMin && (timeSec - xMin) / (xMax - xMin) > 0.9;
    return {
        x: anchorX + (right ? -MARKER_LABEL_DISTANCE_PX : MARKER_LABEL_DISTANCE_PX),
        y: anchorY - MARKER_LABEL_STACK_PX * rank,
        align: right ? 'right' : 'left',
        text,
        rank,
    };
};

/**
 * 하단 라벨 — 상단 이벤트와 겹침 완화.
 * FC Start(상단) vs FC Rolling/FC End(하단): dual-mark 구간에서 시간이 가까워도 안 겹침.
 */
export const LABEL_BELOW_EVENTS = new Set(['FC Rolling', 'FC End', 'Drop', 'TP']);

const buildPointLabel = (
    text: string,
    below: boolean,
    rank: number,
    inward: boolean,
    color: string,
    curveAdjacent: boolean,
) => ({
    show: true,
    position: (curveAdjacent ? (inward ? 'left' : 'right') : below ? 'bottom' : 'top') as
        | 'left'
        | 'right'
        | 'top'
        | 'bottom',
    distance: curveAdjacent ? MARKER_LABEL_DISTANCE_PX : 5,
    offset: [0, rank === 0 ? 0 : -MARKER_LABEL_STACK_PX * rank],
    align: curveAdjacent ? (inward ? 'right' : 'left') : 'center',
    formatter: () => text,
    fontSize: 10,
    fontWeight: 600 as const,
    fontFamily: 'monospace',
    color,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    width: 240,
    overflow: 'truncate' as const,
    ellipsis: '…',
});

export interface MarkerBuildParams {
    charged: boolean;
    currentTimeSec: number;
    xMin: number;
    xMax: number;
    eventMarkerStyle: EventMarkerStyle;
    eventMarkers: RoastEventMarker[];
    turningPoints: TurningPoint[];
    temperatureUnit: TemperatureUnit;
    unitLabel: string;
    xs: number[];
    btActual: (number | null)[];
    colors: ResolvedChartColors;
    tempYMin: number;
    tempYMax: number;
    hasControlSeries: boolean;
    showFcBand?: boolean;
    showTargetDeltaLabel?: boolean;
    targetXs?: number[];
    targetBt?: (number | null)[];
}

export interface MarkerBuildResult {
    allMarkLines: object[];
    markPointData: object[];
    /** FC Start–End vertical band (null if incomplete / invalid range) */
    fcMarkArea: object | null;
    controlGuideMarkLines: object[];
    continuousMarkerLines: { timeSec: number; color: string; width: number }[];
    tempBottomBorderLine: object | null;
}

export const buildMarkers = (params: MarkerBuildParams): MarkerBuildResult => {
    const {
        charged,
        currentTimeSec,
        xMin,
        xMax,
        eventMarkerStyle,
        eventMarkers,
        turningPoints,
        temperatureUnit,
        unitLabel,
        xs,
        btActual,
        colors,
        tempYMin,
        tempYMax,
        hasControlSeries,
        showFcBand = true,
        showTargetDeltaLabel = false,
        targetXs,
        targetBt,
    } = params;

    // Charge: eventMarkers 경유 → eventMarkerStyle(point|line)과 동일 처리
    // NOW: 세로 markLine 가이드 (항상)
    // 이벤트 / TP: eventMarkerStyle 에 따라 line | point
    const usePointMarkers = eventMarkerStyle !== 'line';
    const useContinuousLines = eventMarkerStyle === 'both';
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
        const nowLineStyle = {
            color: colors.currentTimeLine,
            width: 1,
            type: [3, 3] as number[],
            opacity: 1,
        };
        guideMarkLines.push({
            xAxis: currentTimeSec,
            lineStyle: nowLineStyle,
            // label: {
            //     show: true,
            //     position: 'insideEndTop' as const,
            //     formatter: 'NOW',
            //     color: colors.nowLabel,
            //     fontSize: 10,
            //     fontWeight: 700,
            // },
            label: { show: false },
        });
        controlGuideMarkLines.push({
            xAxis: currentTimeSec,
            lineStyle: nowLineStyle,
            label: { show: false },
        });
    }

    const labelTimes = [...eventMarkers.map((marker) => marker.timeSec), ...turningPoints.map((tp) => tp.timeSec)];
    const labelRanks = labelTimes.map(
        (timeSec, index) =>
            labelTimes.slice(0, index).filter((prior) => Math.round(prior) === Math.round(timeSec)).length,
    );
    const isInward = (timeSec: number) => xMax > xMin && (timeSec - xMin) / (xMax - xMin) > 0.9;
    const markerColor = (event: string) => (isControlEvent(event) ? colors.eventControl : colors.eventMark);
    const markerLabelColor = (event: string) => (isControlEvent(event) ? colors.eventControl : colors.markerLabelColor);
    const markerTemp = (m: RoastEventMarker, nearest: number | null) => {
        if (typeof m.tempC === 'number' && Number.isFinite(m.tempC)) return formatTemp(m.tempC, temperatureUnit);
        if (nearest != null) return `${nearest.toFixed(1)}${unitLabel}`;
        return m.temp?.trim() || '—';
    };

    // ── retained line mode: vertical markLine + edge label ────────────────────
    const eventMarkLines = eventMarkers.map((m, index) => {
        const below = LABEL_BELOW_EVENTS.has(m.event);
        const inward = isInward(m.timeSec);
        const color = markerColor(m.event);
        return {
            xAxis: m.timeSec,
            lineStyle: {
                color,
                width: isControlEvent(m.event) ? 1 : 0.6,
                type: 'solid' as const,
                opacity: 1,
            },
            label: {
                show: true,
                position: (below ? 'end' : 'start') as 'start' | 'end',
                formatter: () =>
                    eventLabelText(m.event, m.timeSec, markerTemp(m, nearestBtAt(xs, btActual, m.timeSec)), m.note),
                color: markerLabelColor(m.event),
                fontSize: 11,
                fontWeight: 700,
                align: inward ? 'right' : 'left',
                offset: [inward ? -4 : 4, -MARKER_LABEL_STACK_PX * labelRanks[index]],
            },
        };
    });

    const tpMarkLines = turningPoints.map((tp, index) => ({
        xAxis: tp.timeSec,
        lineStyle: {
            color: colors.eventMark,
            width: 0.6,
            type: 'solid' as const,
            opacity: 1,
        },
        label: {
            show: true,
            position: 'end' as const,
            formatter: () => eventLabelText('TP', tp.timeSec, formatTemp(tp.temp, temperatureUnit)),
            color: colors.markerLabelColor,
            fontSize: 11,
            fontWeight: 700,
            align: isInward(tp.timeSec) ? 'right' : 'left',
            offset: [isInward(tp.timeSec) ? -4 : 4, -MARKER_LABEL_STACK_PX * labelRanks[eventMarkers.length + index]],
        },
    }));

    // ── point style: 작은 점 + 텍스트만 (박스/배경 없음) ────────────────
    const markPointData: object[] = usePointMarkers
        ? ([
              ...eventMarkers.map((m, index) => {
                  const nearest = nearestBtAt(xs, btActual, m.timeSec);
                  const y =
                      nearest ??
                      (typeof m.tempC === 'number' && Number.isFinite(m.tempC)
                          ? toDisplayTemp(m.tempC, temperatureUnit)
                          : tempYMax);
                  const tempStr = markerTemp(m, nearest);
                  const curveAdjacent = eventMarkerStyle === 'both';
                  return {
                      name: m.logId ?? m.event,
                      logId: m.logId,
                      coord: [m.timeSec, y] as [number, number],
                      symbol: 'circle' as const,
                      symbolSize: curveAdjacent ? 0 : 5,
                      itemStyle: {
                          color: markerColor(m.event),
                          borderColor: colors.markerLabelColor,
                          borderWidth: 1,
                      },
                      label: buildPointLabel(
                          eventLabelText(m.event, m.timeSec, tempStr, m.note),
                          LABEL_BELOW_EVENTS.has(m.event),
                          labelRanks[index],
                          isInward(m.timeSec),
                          markerLabelColor(m.event),
                          curveAdjacent,
                      ),
                  };
              }),
              ...turningPoints.map((tp, index) => {
                  const yDisp = nearestBtAt(xs, btActual, tp.timeSec) ?? toDisplayTemp(tp.temp, temperatureUnit);
                  const curveAdjacent = eventMarkerStyle === 'both';
                  return {
                      name: 'TP',
                      coord: [tp.timeSec, yDisp] as [number, number],
                      symbol: 'circle' as const,
                      symbolSize: curveAdjacent ? 0 : 5,
                      itemStyle: {
                          color: colors.eventMark,
                          borderColor: colors.markerLabelColor,
                          borderWidth: 1,
                      },
                      label: buildPointLabel(
                          eventLabelText('TP', tp.timeSec, formatTemp(tp.temp, temperatureUnit)),
                          true,
                          labelRanks[eventMarkers.length + index],
                          isInward(tp.timeSec),
                          colors.markerLabelColor,
                          curveAdjacent,
                      ),
                  };
              }),
          ] as object[])
        : [];

    const targetDeltaPoint = buildTargetDeltaMarkPoint({
        show: showTargetDeltaLabel && currentTimeSec >= xMin && currentTimeSec <= xMax,
        charged,
        currentTimeSec,
        xs,
        btActual,
        targetXs,
        targetBt,
        temperatureUnit,
        colors: {
            within: colors.targetDeltaWithin,
            over: colors.targetDeltaOver,
            under: colors.targetDeltaUnder,
        },
    });
    if (targetDeltaPoint) markPointData.push(targetDeltaPoint);

    const allMarkLines =
        eventMarkerStyle === 'line' ? [...guideMarkLines, ...eventMarkLines, ...tpMarkLines] : guideMarkLines;
    if (eventMarkerStyle === 'line') {
        controlGuideMarkLines.push(
            ...[...eventMarkLines, ...tpMarkLines].map(({ xAxis, lineStyle }) => ({
                xAxis,
                lineStyle,
                label: { show: false },
            })),
        );
    }
    const continuousMarkerLines = useContinuousLines
        ? [
              ...eventMarkers.map((m) => ({
                  timeSec: m.timeSec,
                  color: markerColor(m.event),
                  width: isControlEvent(m.event) ? 1 : 0.6,
              })),
              ...turningPoints.map((tp) => ({ timeSec: tp.timeSec, color: colors.eventMark, width: 0.6 })),
          ]
        : [];

    // FC Start → FC End 세로 밴드 (End 없으면 live currentTime까지).
    // dual-mark FC Rolling is not End — band stays on FC End.
    let fcMarkArea: object | null = null;
    if (showFcBand) {
        const fcStart = eventMarkers.find((m) => m.event === 'FC Start');
        const fcEnd = eventMarkers.find((m) => m.event === 'FC End');
        if (fcStart) {
            const endSec = fcEnd?.timeSec ?? (charged ? currentTimeSec : null);
            if (endSec != null && endSec > fcStart.timeSec) {
                fcMarkArea = {
                    silent: true,
                    z: 0,
                    itemStyle: {
                        color: colors.fcBandFill,
                    },
                    data: [[{ xAxis: fcStart.timeSec }, { xAxis: endSec }]],
                };
            }
        }
    }

    // dual-grid: bottom edge of temp plot (axisLine is unreliable on value xAxis)
    const tempBottomBorderLine = hasControlSeries
        ? {
              yAxis: tempYMin,
              silent: true,
              symbol: 'none' as const,
              lineStyle: { color: colors.axisLabel, width: 1, type: 'solid' as const },
              label: { show: false },
          }
        : null;

    return {
        allMarkLines,
        markPointData: markPointData as object[],
        fcMarkArea,
        controlGuideMarkLines,
        continuousMarkerLines,
        tempBottomBorderLine,
    };
};
