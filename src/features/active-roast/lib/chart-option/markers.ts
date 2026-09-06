import type { EventMarkerStyle, TemperatureUnit, TurningPoint } from '@features/active-roast';
import { toDisplayTemp } from '@features/active-roast/lib/temperature';
import { fmtSec } from './axes';
import { buildTargetDeltaMarkPoint } from './target-delta-label';
import type { ResolvedChartColors, RoastEventMarker, UpcomingHeaterMark } from './types';

/** 시간축에서 가장 가까운 BT 표시값 조회 */
export const nearestBtAt = (xs: number[], btActual: (number | null)[], timeSec: number): number | null => {
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
    return bestIdx >= 0 ? btActual[bestIdx] : null;
};

// Charge는 t=0 고정 → 시간 생략 (event + temp만)
export const eventLabelText = (event: string, timeStr: string, temp: string) =>
    event === 'Charge' ? `${event} ${temp}` : `${event} ${timeStr} ${temp}`;

/**
 * 하단 라벨 — 상단 이벤트와 겹침 완화.
 * FC Start(상단) vs FC Rolling/FC End(하단): dual-mark 구간에서 시간이 가까워도 안 겹침.
 */
export const LABEL_BELOW_EVENTS = new Set(['FC Rolling', 'FC End', 'Drop', 'TP']);

/** 다음 1개 화력 + 남은 N. 숫자라 로케일 없음 */
export const upcomingHeaterLabel = (
    heater: number,
    remainingAfter: number,
    bt?: { display: number; unitLabel: string },
): string => {
    const pct = `${Math.round(heater)}%`;
    const extra = remainingAfter > 0 ? ` +${remainingAfter}` : '';
    return bt ? `BT ${Math.round(bt.display)}${bt.unitLabel} → ${pct}${extra}` : `${pct}${extra}`;
};

const buildPointLabel = (text: string, below = false) => ({
    show: true,
    position: (below ? 'bottom' : 'top') as 'top' | 'bottom',
    distance: 5,
    formatter: text,
    fontSize: 10,
    fontWeight: 600 as const,
    fontFamily: 'monospace',
    color: '#0b0b0b',
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
});

export interface MarkerBuildParams {
    charged: boolean;
    currentTimeSec: number;
    xMin: number;
    xMax: number;
    eventMarkerStyle: EventMarkerStyle;
    eventMarkers: RoastEventMarker[];
    upcomingHeaterMark?: UpcomingHeaterMark | null;
    turningPoints: TurningPoint[];
    temperatureUnit: TemperatureUnit;
    unitLabel: string;
    xs: number[];
    btActual: (number | null)[];
    colors: ResolvedChartColors;
    tempYMin: number;
    hasControlSeries: boolean;
    showControlHeat?: boolean;
    showFcBand?: boolean;
    showTargetDeltaLabel?: boolean;
    targetXs?: number[];
    targetBt?: (number | null)[];
}

export interface MarkerBuildResult {
    usePointMarkers: boolean;
    allMarkLines: object[];
    markPointData: object[];
    /** FC Start–End vertical band (null if incomplete / invalid range) */
    fcMarkArea: object | null;
    controlGuideMarkLines: object[];
    heatMarkLines: object[];
    heatMarkPoints: object[];
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
        upcomingHeaterMark,
        turningPoints,
        temperatureUnit,
        unitLabel,
        xs,
        btActual,
        colors,
        tempYMin,
        hasControlSeries,
        showControlHeat = true,
        showFcBand = true,
        showTargetDeltaLabel = false,
        targetXs,
        targetBt,
    } = params;

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

    // ── line style: 세로 markLine + 라벨 (기본 상단, FC End/Drop은 하단) ─
    const eventMarkLines = eventMarkers.map((m) => {
        const below = LABEL_BELOW_EVENTS.has(m.event);
        return {
            xAxis: m.timeSec,
            lineStyle: {
                color: m.color,
                width: 1.5,
                type: 'solid' as const,
                opacity: 1,
            },
            label: {
                show: true,
                // vertical xAxis line: start=top, end=bottom
                position: (below ? 'end' : 'start') as 'start' | 'end',
                formatter: eventLabelText(m.event, m.timeStr, m.temp),
                color: m.color,
                fontSize: 11,
                fontWeight: 700,
            },
        };
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
            position: 'end' as const,
            formatter: `TP ${fmtSec(tp.timeSec)} ${toDisplayTemp(tp.temp, temperatureUnit).toFixed(1)}${unitLabel}`,
            color: colors.tp,
            fontSize: 11,
            fontWeight: 700,
        },
    }));

    // ── point style: 작은 점 + 텍스트만 (박스/배경 없음) ────────────────
    const markPointData: object[] = usePointMarkers
        ? ([
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
                          label: buildPointLabel(
                              eventLabelText(m.event, m.timeStr, tempStr),
                              LABEL_BELOW_EVENTS.has(m.event),
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
                      label: buildPointLabel(`TP ${fmtSec(tp.timeSec)} ${tempStr}`, true),
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

    const heatMarkLines: object[] = [];
    const heatMarkPoints: object[] = [];
    const extraTempMarkLines: object[] = [];
    if (upcomingHeaterMark) {
        const { timeSec, btC, heater, remainingAfter, axis } = upcomingHeaterMark;
        const color = colors.controlHeat;
        const lineStyle = { color, width: 1, type: [4, 3] as number[], opacity: 0.9 };
        if (axis === 'bt') {
            const y = toDisplayTemp(btC, temperatureUnit);
            extraTempMarkLines.push({
                yAxis: y,
                lineStyle,
                label: {
                    show: true,
                    formatter: upcomingHeaterLabel(heater, remainingAfter, { display: y, unitLabel }),
                    color,
                    fontSize: 10,
                    fontWeight: 600,
                },
            });
        } else if (hasControlSeries && showControlHeat) {
            heatMarkLines.push({ xAxis: timeSec, lineStyle, label: { show: false } });
            heatMarkPoints.push({
                name: 'Replay',
                coord: [timeSec, heater] as [number, number],
                symbol: 'circle' as const,
                symbolSize: 7,
                itemStyle: { color, borderColor: colors.markerLabelColor, borderWidth: 1 },
                label: {
                    show: true,
                    position: 'top' as const,
                    formatter: upcomingHeaterLabel(heater, remainingAfter),
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: 'monospace',
                    color: '#0b0b0b',
                    backgroundColor: 'transparent',
                    borderWidth: 0,
                    padding: 0,
                },
            });
        } else {
            extraTempMarkLines.push({
                xAxis: timeSec,
                lineStyle,
                label: {
                    show: true,
                    position: 'end' as const,
                    formatter: upcomingHeaterLabel(heater, remainingAfter),
                    color,
                    fontSize: 10,
                    fontWeight: 600,
                },
            });
        }
    }

    const allMarkLines = usePointMarkers
        ? [...guideMarkLines, ...extraTempMarkLines]
        : [...guideMarkLines, ...eventMarkLines, ...tpMarkLines, ...extraTempMarkLines];

    // FC Start → FC End 세로 밴드 (End 없으면 live currentTime까지)
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
        usePointMarkers,
        allMarkLines,
        markPointData: markPointData as object[],
        fcMarkArea,
        controlGuideMarkLines,
        heatMarkLines,
        heatMarkPoints,
        tempBottomBorderLine,
    };
};
