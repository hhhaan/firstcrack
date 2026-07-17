import type { EventMarkerStyle, TemperatureUnit, TurningPoint } from '@features/active-roast';
import { toDisplayTemp } from '@features/active-roast/lib/temperature';
import { fmtSec } from './axes';
import type { ResolvedChartColors, RoastEventMarker } from './types';

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
    return bestIdx >= 0 ? (btActual[bestIdx] as number) : null;
};

// Charge는 t=0 고정 → 시간 생략 (event + temp만)
export const eventLabelText = (event: string, timeStr: string, temp: string) =>
    event === 'Charge' ? `${event} ${temp}` : `${event} ${timeStr} ${temp}`;

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
    hasControlSeries: boolean;
}

export interface MarkerBuildResult {
    usePointMarkers: boolean;
    allMarkLines: object[];
    markPointData: object[];
    controlGuideMarkLines: object[];
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
        hasControlSeries,
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
            lineStyle: nowLineStyle,
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
        controlGuideMarkLines,
        tempBottomBorderLine,
    };
};
