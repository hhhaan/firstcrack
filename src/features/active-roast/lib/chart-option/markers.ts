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
    const name = event === 'Note' ? note?.trim() || event : event === 'Heater' && note ? `${event}→${note}` : event;
    return `${name}|${formatMarkerTime(timeSec)}|${temp || '—'}`;
};

export const MARKER_LABEL_STACK_PX = 14;
export const MARKER_LABEL_DISTANCE_PX = 0;
export const MARKER_LABEL_MAX_WIDTH_PX = 240;
export const MARKER_LABEL_CHAR_WIDTH_PX = 6;
export const MARKER_LABEL_GAP_PX = 2;
/** Gap from the event line to the left edge of the label. */
export const MARKER_LABEL_X_OFFSET_PX = 4;

export const markerLabelDy = (below: boolean, rank = 0) =>
    (below ? MARKER_LABEL_DISTANCE_PX : -MARKER_LABEL_DISTANCE_PX) - MARKER_LABEL_STACK_PX * rank;

export const estimateLabelWidth = (text: string) =>
    Math.min(MARKER_LABEL_MAX_WIDTH_PX, Math.max(8, text.length * MARKER_LABEL_CHAR_WIDTH_PX));

export interface MarkerLabelGeometry {
    x: number;
    y: number;
    align: 'left';
    text: string;
    rank: number;
}

export interface CurveLabelItem {
    timeSec: number;
    y: number;
    text: string;
    color: string;
    below: boolean;
    showDot: boolean;
}

export interface CurveLabelLayoutInput {
    timeSec: number;
    xPx: number;
    yPx: number;
    text: string;
    below: boolean;
    color: string;
    showDot: boolean;
}

export interface CurveLabelBox {
    x: number;
    textY: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    below: boolean;
    text: string;
    color: string;
    showDot: boolean;
    anchorX: number;
    anchorY: number;
    timeSec: number;
}

const boxesOverlap = (a: CurveLabelBox, b: CurveLabelBox) =>
    a.left < b.right + MARKER_LABEL_GAP_PX &&
    a.right + MARKER_LABEL_GAP_PX > b.left &&
    a.top < b.bottom + MARKER_LABEL_GAP_PX &&
    a.bottom + MARKER_LABEL_GAP_PX > b.top;

const makeLabelBox = (item: CurveLabelLayoutInput, textY: number, canvasWidth: number): CurveLabelBox => {
    const width = Math.min(estimateLabelWidth(item.text), Math.max(0, canvasWidth - 8));
    const x = Math.max(4, Math.min(item.xPx + MARKER_LABEL_X_OFFSET_PX, canvasWidth - 4 - width));
    const top = item.below ? textY : textY - MARKER_LABEL_STACK_PX;
    const bottom = item.below ? textY + MARKER_LABEL_STACK_PX : textY;
    return {
        x,
        textY,
        left: x,
        right: x + width,
        top,
        bottom,
        below: item.below,
        text: item.text,
        color: item.color,
        showDot: item.showDot,
        anchorX: item.xPx,
        anchorY: item.yPx,
        timeSec: item.timeSec,
    };
};

/** Time-ordered greedy packing. Prefer the curve side, then flip if still blocked. */
export const layoutCurveLabelBoxes = (items: CurveLabelLayoutInput[], canvasWidth = Infinity): CurveLabelBox[] => {
    const order = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => Number.isFinite(item.xPx) && Number.isFinite(item.yPx))
        .sort((a, b) => a.item.timeSec - b.item.timeSec || a.index - b.index);
    const placed: CurveLabelBox[] = [];
    const byIndex: CurveLabelBox[] = [];
    for (const { item, index } of order) {
        let textY = item.yPx + markerLabelDy(item.below);
        let box = makeLabelBox(item, textY, canvasWidth);
        const trySteps = (dir: number) => {
            let step = 0;
            let next = box;
            while (placed.some((prior) => boxesOverlap(next, prior)) && step < 24) {
                textY += dir * MARKER_LABEL_STACK_PX;
                next = makeLabelBox(item, textY, canvasWidth);
                step += 1;
            }
            return next;
        };
        box = trySteps(item.below ? 1 : -1);
        if (placed.some((prior) => boxesOverlap(box, prior))) {
            textY = item.yPx + markerLabelDy(item.below);
            box = makeLabelBox(item, textY, canvasWidth);
            box = trySteps(item.below ? -1 : 1);
        }
        placed.push(box);
        byIndex[index] = box;
    }
    return items.map((_, index) => byIndex[index]).filter(Boolean);
};

/** Exact curve-label geometry shared with pointer hit-testing. Coordinates are CSS pixels. */
export const getMarkerLabelGeometry = ({
    anchorX,
    anchorY,
    rank,
    text,
    below = false,
}: {
    anchorX: number;
    anchorY: number;
    rank: number;
    text: string;
    below?: boolean;
}): MarkerLabelGeometry => ({
    x: anchorX + MARKER_LABEL_X_OFFSET_PX,
    y: anchorY + markerLabelDy(below, rank),
    align: 'left',
    text,
    rank,
});

/**
 * 커브 기준 하단 라벨 — 같은 시각 상단 이벤트와 겹침 완화.
 * FC Start(상단) vs FC Rolling/FC End(하단). Drop은 커브 위(우측 군집 회피).
 */
export const LABEL_BELOW_EVENTS = new Set(['FC Rolling', 'FC End', 'TP']);

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
    hideChargeLabel?: boolean;
}

export interface MarkerBuildResult {
    allMarkLines: object[];
    markPointData: object[];
    curveLabels: CurveLabelItem[];
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
        hideChargeLabel = false,
    } = params;

    // Charge: t=0 = 좌단 축 (#451). 세로선 없음. 라이브는 라벨도 숨김.
    // NOW: 세로 markLine 가이드 (항상)
    // 라벨은 항상 BT 커브 위 custom series. 점은 point 모드만.
    const useContinuousLines = eventMarkerStyle === 'both';
    const guideMarkLines: object[] = [];
    const controlGuideMarkLines: object[] = [];
    const lineEvents = eventMarkers.filter((m) => m.event !== 'Charge');
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

    const markerColor = (event: string) => (isControlEvent(event) ? colors.eventControl : colors.eventMark);
    const markerLabelColor = (event: string) => (isControlEvent(event) ? colors.eventControl : colors.markerLabelColor);
    const markerTemp = (m: RoastEventMarker, nearest: number | null) => {
        if (typeof m.tempC === 'number' && Number.isFinite(m.tempC)) return formatTemp(m.tempC, temperatureUnit);
        if (nearest != null) return `${nearest.toFixed(1)}${unitLabel}`;
        return m.temp?.trim() || '—';
    };

    // ── line mode: unlabeled verticals (labels are drawn on BT via custom series)
    const eventMarkLines = lineEvents.map((m) => ({
        xAxis: m.timeSec,
        lineStyle: {
            color: markerColor(m.event),
            width: isControlEvent(m.event) ? 1 : 0.6,
            type: 'solid' as const,
            opacity: 1,
        },
        label: { show: false },
    }));

    const tpMarkLines = turningPoints.map((tp) => ({
        xAxis: tp.timeSec,
        lineStyle: {
            color: colors.eventMark,
            width: 0.6,
            type: 'solid' as const,
            opacity: 1,
        },
        label: { show: false },
    }));

    const showDot = eventMarkerStyle === 'point';
    const labeledEvents = hideChargeLabel ? eventMarkers.filter((m) => m.event !== 'Charge') : eventMarkers;
    const curveLabels: CurveLabelItem[] = [
        ...labeledEvents.map((m) => {
            const nearest = nearestBtAt(xs, btActual, m.timeSec);
            const y =
                nearest ??
                (typeof m.tempC === 'number' && Number.isFinite(m.tempC)
                    ? toDisplayTemp(m.tempC, temperatureUnit)
                    : tempYMax);
            return {
                timeSec: m.timeSec,
                y,
                text: eventLabelText(m.event, m.timeSec, markerTemp(m, nearest), m.note),
                color: markerLabelColor(m.event),
                below: LABEL_BELOW_EVENTS.has(m.event),
                showDot: m.event === 'Charge' ? false : showDot,
            };
        }),
        ...turningPoints.map((tp) => ({
            timeSec: tp.timeSec,
            y: nearestBtAt(xs, btActual, tp.timeSec) ?? toDisplayTemp(tp.temp, temperatureUnit),
            text: eventLabelText('TP', tp.timeSec, formatTemp(tp.temp, temperatureUnit)),
            color: colors.markerLabelColor,
            below: true,
            showDot,
        })),
    ];

    const markPointData: object[] = [];

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
              ...lineEvents.map((m) => ({
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
        curveLabels,
        fcMarkArea,
        controlGuideMarkLines,
        continuousMarkerLines,
        tempBottomBorderLine,
    };
};
