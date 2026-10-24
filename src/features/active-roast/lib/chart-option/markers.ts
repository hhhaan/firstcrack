import {
    EVENT_MARK_LINE_WIDTH,
    isControlEvent,
    MARKER_LABEL_CANVAS_GUTTER_PX,
    MARKER_LABEL_CHAR_WIDTH_PX,
    MARKER_LABEL_DISTANCE_PX,
    MARKER_LABEL_FONT_SIZE,
    MARKER_LABEL_GAP_PX,
    MARKER_LABEL_MAX_WIDTH_PX,
    MARKER_LABEL_MIN_WIDTH_PX,
    MARKER_LABEL_STACK_PX,
    MARKER_LABEL_X_OFFSET_PX,
    REFERENCE_CURVE_OPACITY,
    scaleChartPx,
} from '@features/active-roast/lib/chart-config';
import { controlChangeLabel, formatRoastNote } from '@features/active-roast/lib/roast-note';
import { formatTemp, toDisplayTemp } from '@features/active-roast/lib/temperature';
import { roastEventLabel } from '@shared/i18n/roast-event-label';
import type { EventMarkerStyle, TemperatureUnit } from '../../model/settings';
import type { TurningPoint } from '../turningPoints';
import { buildTargetDeltaMarkPoint } from './target-delta-label';
import type { ResolvedChartColors, RoastEventMarker } from './types';

/**
 * Live samples are ~0.5–1s apart. Farther than this is not this event's BT
 * (a zoomed slice's nearest point can be minutes away).
 * ponytail: fixed gap, not median dt — widen the constant if polls get sparser than 5s.
 */
export const NEAREST_BT_MAX_SEC = 5;

/** 시간축에서 가장 가까운 BT 표시값 조회. 허용 거리 밖이면 null. */
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
    return bestIdx >= 0 && bestDist <= NEAREST_BT_MAX_SEC ? btActual[bestIdx] : null;
};

/** In-window marker with a nearby BT sample, or an in-window marker on an empty curve. */
export const isCurveMarkerVisible = (
    timeSec: number,
    xMin: number,
    xMax: number,
    xs: number[],
    btActual: (number | null)[],
): boolean => {
    if (!Number.isFinite(timeSec) || timeSec < xMin || timeSec > xMax) return false;
    if (nearestBtAt(xs, btActual, timeSec) != null) return true;
    return !xs.some((x, i) => Number.isFinite(x) && Number.isFinite(btActual[i]));
};

/** Notes and fan/drum writes hang from the top of the temperature axis. They do not follow BT. */
export const noteAnchoredAtTop = (event: string) => event === 'Note' || event === 'Fan' || event === 'Drum';

/** Pixels a note label sits below the top of the temperature axis. */
export const NOTE_LABEL_TOP_INSET_PX = 8;

export const noteLabelTopInsetPx = (atTop: boolean, scale = 1) =>
    atTop ? scaleChartPx(NOTE_LABEL_TOP_INSET_PX, scale) : 0;

/** Notes stay on the time axis ahead of the live curve. Other events need a nearby BT sample. */
export const isEventMarkerVisible = (
    event: string,
    timeSec: number,
    xMin: number,
    xMax: number,
    xs: number[],
    btActual: (number | null)[],
): boolean => {
    if (!Number.isFinite(timeSec) || timeSec < xMin || timeSec > xMax) return false;
    if (event === 'Note' || event === 'Fan' || event === 'Drum') return true;
    return isCurveMarkerVisible(timeSec, xMin, xMax, xs, btActual);
};

const formatMarkerTime = (timeSec: number) => {
    const sign = timeSec < 0 ? '-' : '';
    const sec = Math.floor(Math.abs(timeSec));
    return `${sign}${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};

const hasMarkerTemp = (temp: string) => {
    const value = temp.trim();
    return value !== '' && value !== '—' && value !== '-' && value !== '–';
};

export const eventLabelText = (event: string, timeSec: number, temp: string, note?: string) => {
    if (event === 'Fan' || event === 'Drum') {
        const value = Number(note);
        const body = Number.isFinite(value)
            ? controlChangeLabel(event === 'Fan' ? 'fan' : 'drum', value)
            : note?.trim() || event;
        return `${body}|${formatMarkerTime(timeSec)}`;
    }
    const name =
        event === 'Note'
            ? note?.trim() || event
            : event === 'Heater' && note
              ? `${event}→${note}`
              : roastEventLabel(event);
    const time = formatMarkerTime(timeSec);
    if (event === 'Note' && name.includes('\n')) {
        return `${hasMarkerTemp(temp) ? `${time} | ${temp}` : time}\n${name}`;
    }
    return hasMarkerTemp(temp) ? `${name}|${time}|${temp}` : `${name}|${time}`;
};

export const markerLabelDy = (below: boolean, rank = 0, scale = 1) => {
    const distance = scaleChartPx(MARKER_LABEL_DISTANCE_PX, scale);
    const stack = scaleChartPx(MARKER_LABEL_STACK_PX, scale);
    return (below ? distance : -distance) - stack * rank;
};

/** ASCII is 6px; Hangul and other non-ASCII are one em so the hit box matches the canvas glyph. */
const markerLabelAdvance = (text: string) => {
    let px = 0;
    for (const ch of text) {
        px += (ch.codePointAt(0) ?? 0) > 0xff ? MARKER_LABEL_FONT_SIZE : MARKER_LABEL_CHAR_WIDTH_PX;
    }
    return px;
};

export const estimateLabelWidth = (text: string, scale = 1) =>
    Math.min(
        scaleChartPx(MARKER_LABEL_MAX_WIDTH_PX, scale),
        Math.max(
            scaleChartPx(MARKER_LABEL_MIN_WIDTH_PX, scale),
            ...text.split('\n').map((line) => scaleChartPx(markerLabelAdvance(line), scale)),
        ),
    );

/** Wrap canvas text explicitly so packing and pointer hit boxes use the same lines. */
export const wrapMarkerLabel = (text: string, width: number, scale = 1): string =>
    text
        .split('\n')
        .flatMap((line) => {
            const lines: string[] = [];
            let current = '';
            for (const char of line) {
                if (current && scaleChartPx(markerLabelAdvance(current + char), scale) > width) {
                    lines.push(current);
                    current = '';
                }
                current += char;
            }
            lines.push(current);
            return lines;
        })
        .join('\n');

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
    opacity?: number;
    below: boolean;
    showDot: boolean;
    /** Major event text starts at the plot top; its point stays at y. */
    labelAtTop?: boolean;
    /** Extra pixels below the anchor. Notes use this to clear the top axis line. */
    topInsetPx?: number;
}

export interface CurveLabelLayoutInput {
    timeSec: number;
    xPx: number;
    yPx: number;
    text: string;
    below: boolean;
    color: string;
    opacity?: number;
    showDot: boolean;
    labelTopPx?: number;
    topInsetPx?: number;
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
    /** Complete original content; oversized labels have a compact canvas preview. */
    fullText: string;
    color: string;
    opacity: number;
    showDot: boolean;
    labelAtTop: boolean;
    anchorX: number;
    anchorY: number;
    timeSec: number;
}

const labelsNeedStacking = (a: CurveLabelBox, b: CurveLabelBox, scale: number) => {
    const gap = scaleChartPx(MARKER_LABEL_GAP_PX, scale);
    if (a.bottom <= a.top || b.bottom <= b.top) return false;
    if (a.labelAtTop && b.labelAtTop) return true;
    if (a.left >= b.right + gap || a.right + gap <= b.left) return false;
    return a.labelAtTop === b.labelAtTop || (a.top < b.bottom + gap && a.bottom + gap > b.top);
};

const moveLabelBox = (box: CurveLabelBox, top: number) => {
    const offset = top - box.top;
    box.top = top;
    box.bottom += offset;
    box.textY += offset;
};

const makeLabelBox = (
    item: CurveLabelLayoutInput,
    textY: number,
    canvasWidth: number,
    scale: number,
    canvasHeight: number,
): CurveLabelBox => {
    const gutter = scaleChartPx(MARKER_LABEL_CANVAS_GUTTER_PX, scale);
    const xOffset = scaleChartPx(MARKER_LABEL_X_OFFSET_PX, scale);
    const stack = scaleChartPx(MARKER_LABEL_STACK_PX, scale);
    const width = Math.min(estimateLabelWidth(item.text, scale), Math.max(0, canvasWidth - gutter));
    const lines = wrapMarkerLabel(item.text, width, scale).split('\n');
    const maxLines = Math.max(0, Math.floor(canvasHeight / stack));
    // Oversized labels leave room for other marks. The event-details panel retains every value.
    const visible =
        lines.length > maxLines ? (maxLines > 0 ? [...lines.slice(0, Math.min(2, maxLines - 1)), '…'] : []) : lines;
    const text = visible.join('\n');
    const height = stack * visible.length;
    textY = item.below
        ? Math.max(0, Math.min(textY, Math.max(0, canvasHeight - height)))
        : Math.max(height, Math.min(textY, canvasHeight));
    const rawX = item.xPx + xOffset;
    // Clamp only anchors already on the canvas. Off-chart anchors must stay off-chart.
    const anchorOnCanvas = item.xPx >= 0 && item.xPx <= canvasWidth;
    const x = anchorOnCanvas
        ? Math.max(xOffset, Math.min(rawX, Math.max(xOffset, canvasWidth - xOffset - width)))
        : rawX;
    const top = item.below ? textY : textY - height;
    const bottom = item.below ? textY + height : textY;
    return {
        x,
        textY,
        left: x,
        right: x + width,
        top,
        bottom,
        below: item.below,
        text,
        fullText: item.text,
        color: item.color,
        opacity: item.opacity ?? 1,
        showDot: item.showDot,
        labelAtTop: item.labelTopPx != null,
        anchorX: item.xPx,
        anchorY: item.yPx,
        timeSec: item.timeSec,
    };
};

const labelTextY = (item: CurveLabelLayoutInput, scale: number) =>
    (item.labelTopPx ?? item.yPx) + markerLabelDy(item.below, 0, scale) + (item.topInsetPx ?? 0);

/**
 * Axis max converts to the plot top and can land a fraction above it.
 * Keep that edge so the 8px inset is measured from the axis line, not dropped.
 */
export const clampCurveLabelY = (yPx: number, plotY: number, plotHeight: number): number | null => {
    if (!Number.isFinite(yPx) || yPx > plotY + plotHeight) return null;
    if (yPx >= plotY) return yPx;
    return plotY - yPx <= 1 ? plotY : null;
};

/** Neighboring labels read chronologically from top to bottom while their curve anchors stay fixed. */
export const layoutCurveLabelBoxes = (
    items: CurveLabelLayoutInput[],
    canvasWidth = Infinity,
    scale = 1,
    canvasHeight = Infinity,
): CurveLabelBox[] => {
    const gap = scaleChartPx(MARKER_LABEL_GAP_PX, scale);
    const order = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => Number.isFinite(item.xPx) && Number.isFinite(item.yPx))
        .sort((a, b) => a.item.timeSec - b.item.timeSec || a.index - b.index);
    const placed: CurveLabelBox[] = [];
    const byIndex: CurveLabelBox[] = [];
    for (const { item, index } of order) {
        const box = makeLabelBox(item, labelTextY(item, scale), canvasWidth, scale, canvasHeight);
        for (const prior of placed) {
            if (labelsNeedStacking(box, prior, scale)) {
                moveLabelBox(box, Math.max(box.top, prior.bottom + gap));
            }
        }
        placed.push(box);
        byIndex[index] = box;
    }
    // Make room above a bottom-edge cluster without reversing its event order.
    for (let index = placed.length - 1; index >= 0; index--) {
        const box = placed[index];
        let bottom = canvasHeight;
        for (let next = index + 1; next < placed.length; next++) {
            if (labelsNeedStacking(box, placed[next], scale)) bottom = Math.min(bottom, placed[next].top - gap);
        }
        moveLabelBox(box, Math.max(0, Math.min(box.top, bottom - (box.bottom - box.top))));
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
    scale = 1,
}: {
    anchorX: number;
    anchorY: number;
    rank: number;
    text: string;
    below?: boolean;
    scale?: number;
}): MarkerLabelGeometry => ({
    x: anchorX + scaleChartPx(MARKER_LABEL_X_OFFSET_PX, scale),
    y: anchorY + markerLabelDy(below, rank, scale),
    align: 'left',
    text,
    rank,
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
    hideChargeLabel?: boolean;
    /** 1, 1.5, or 2. Label inset and the target-delta mark use this. */
    fontScale?: number;
}

export interface MarkerBuildResult {
    allMarkLines: object[];
    markPointData: object[];
    curveLabels: CurveLabelItem[];
    /** FC Start–End vertical band (null if incomplete / invalid range) */
    fcMarkArea: object | null;
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
        tempYMax,
        hasControlSeries,
        showFcBand = true,
        showTargetDeltaLabel = false,
        targetXs,
        targetBt,
        hideChargeLabel = false,
        fontScale = 1,
    } = params;

    // Charge: t=0 = 좌단 축 (#451). 세로선 없음. 라이브는 라벨도 숨김.
    // NOW: 세로 markLine 가이드 (항상)
    // 라벨은 항상 BT 커브 위 custom series. 점은 point 모드만.
    // tempLine: 온도 차트만. line: 온도 차트와 컨트롤 차트.
    const guideMarkLines: object[] = [];
    const controlGuideMarkLines: object[] = [];
    const markerVisible = (marker: RoastEventMarker) =>
        marker.reference
            ? Number.isFinite(marker.timeSec) && marker.timeSec >= xMin && marker.timeSec <= xMax
            : isEventMarkerVisible(marker.event, marker.timeSec, xMin, xMax, xs, btActual);
    const lineEvents = eventMarkers.filter((m) => m.event !== 'Charge' && markerVisible(m));
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
            width: EVENT_MARK_LINE_WIDTH,
            type: 'solid' as const,
            opacity: m.reference ? REFERENCE_CURVE_OPACITY : 1,
        },
        label: { show: false },
    }));

    const visibleTurningPoints = turningPoints.filter((tp) =>
        isCurveMarkerVisible(tp.timeSec, xMin, xMax, xs, btActual),
    );
    const tpMarkLines = visibleTurningPoints.map((tp) => ({
        xAxis: tp.timeSec,
        lineStyle: {
            color: colors.eventMark,
            width: EVENT_MARK_LINE_WIDTH,
            type: 'solid' as const,
            opacity: 1,
        },
        label: { show: false },
    }));

    const showDot = eventMarkerStyle === 'point';
    const labeledEvents = (hideChargeLabel ? eventMarkers.filter((m) => m.event !== 'Charge') : eventMarkers).filter(
        markerVisible,
    );
    const curveLabels: CurveLabelItem[] = [
        ...labeledEvents.map((m) => {
            const nearest = m.reference ? null : nearestBtAt(xs, btActual, m.timeSec);
            const atTop = noteAnchoredAtTop(m.event);
            const y = atTop
                ? tempYMax
                : (nearest ??
                  (typeof m.tempC === 'number' && Number.isFinite(m.tempC)
                      ? toDisplayTemp(m.tempC, temperatureUnit)
                      : tempYMax));
            return {
                timeSec: m.timeSec,
                y,
                text: eventLabelText(
                    m.event,
                    m.timeSec,
                    markerTemp(m, nearest),
                    m.event === 'Note' ? formatRoastNote(m, '\n') : m.note,
                ),
                color: markerLabelColor(m.event),
                opacity: m.reference ? REFERENCE_CURVE_OPACITY : 1,
                below: m.event !== 'Heater',
                showDot: m.event === 'Charge' ? false : showDot,
                labelAtTop: !atTop && m.event !== 'Heater',
                topInsetPx: noteLabelTopInsetPx(m.event !== 'Heater', fontScale),
            };
        }),
        ...visibleTurningPoints.map((tp) => ({
            timeSec: tp.timeSec,
            y: nearestBtAt(xs, btActual, tp.timeSec) ?? toDisplayTemp(tp.temp, temperatureUnit),
            text: eventLabelText('TP', tp.timeSec, formatTemp(tp.temp, temperatureUnit)),
            color: colors.markerLabelColor,
            below: true,
            showDot,
            labelAtTop: true,
            topInsetPx: noteLabelTopInsetPx(true, fontScale),
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
        fontScale,
    });
    if (targetDeltaPoint) markPointData.push(targetDeltaPoint);

    const showTempLine = eventMarkerStyle === 'line' || eventMarkerStyle === 'tempLine';
    const allMarkLines = showTempLine ? [...guideMarkLines, ...eventMarkLines, ...tpMarkLines] : guideMarkLines;
    if (eventMarkerStyle === 'line') {
        controlGuideMarkLines.push(
            ...[...eventMarkLines, ...tpMarkLines].map(({ xAxis, lineStyle }) => ({
                xAxis,
                lineStyle,
                label: { show: false },
            })),
        );
    }

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
        tempBottomBorderLine,
    };
};
