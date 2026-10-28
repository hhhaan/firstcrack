import {
    MARKER_LABEL_CHAR_WIDTH_PX,
    MARKER_LABEL_GAP_PX,
    MARKER_LABEL_STACK_PX,
    markerLabelFont,
    PHASE_BAR_FONT_FAMILY,
    PHASE_BAR_FONT_SIZE,
    PHASE_BAR_FONT_SIZE_NARROW,
    PHASE_BAR_FONT_WEIGHT,
    PHASE_BAR_HEIGHT,
    PHASE_BAR_NARROW_THRESHOLD,
    PHASE_BAR_STROKE_WIDTH,
    PHASE_BAR_TEXT_INSET,
    scaleChartPx,
} from '@features/active-roast/lib/chart-config';
import type { CurveLineStyle, ResolvedCurveStyles } from '@features/active-roast/lib/curve-style';
import { toDisplayTemp } from '@features/active-roast/lib/temperature';
import { formatElapsed } from '@shared/lib/format';
import * as echarts from 'echarts';
import type { TemperatureUnit } from '../../model/settings';
import type { PhaseSegment } from '../phases';
import { curveLabelLeader, projectCurveLabels } from './curve-label-projection';
import type { CurveLabelItem } from './markers';
import type { ControlData, ResolvedChartColors } from './types';

export const lineSeriesBase = {
    showSymbol: false,
    // Axis highlight still builds a temp symbol when showSymbol is false.
    // 'none' draws nothing. scale:false stops the default emphasis grow.
    symbol: 'none' as const,
    symbolSize: 0,
    emphasis: { disabled: true, scale: false },
};

const hasNumericSample = (values: readonly (number | null)[] | undefined): boolean =>
    values?.some((value) => value != null) ?? false;

const CONTROL_CHANGE_FONT_SIZE = 10;
const CONTROL_CHANGE_DOT_PX = 4;
/** Change stamp appears once the live tail is this far past the write. */
const CONTROL_CHANGE_LABEL_DELAY_SEC = 5;

type ControlPoint = readonly [number, number | null];

/** Change labels come only from acknowledged app writes; the tail remains the current measurement. */
const controlMarks = (
    data: readonly ControlPoint[],
    changes: ControlData['changes'],
    role: 'heater' | 'fan' | 'drum',
    style: CurveLineStyle,
    fontScale: number,
) => {
    const text = {
        show: true,
        color: style.color,
        opacity: style.opacity ?? 1,
        fontFamily: PHASE_BAR_FONT_FAMILY,
        fontWeight: PHASE_BAR_FONT_WEIGHT,
        fontSize: scaleChartPx(CONTROL_CHANGE_FONT_SIZE, fontScale),
    };
    const mark = (time: number, value: number) => ({
        coord: [time, value] as [number, number],
        symbol: 'circle' as const,
        symbolSize: scaleChartPx(CONTROL_CHANGE_DOT_PX, fontScale),
        // ECharts drops the label when the symbol is none or size 0. Keep a transparent circle.
        itemStyle: { color: 'transparent', borderWidth: 0, opacity: style.opacity ?? 1 },
        label: {
            ...text,
            position: 'top' as const,
            align: 'right' as const,
            distance: 2,
            formatter: String(Number(value.toFixed(2))),
        },
    });
    const tail = data.length > 0 ? data[data.length - 1] : undefined;
    const tailTime = tail && typeof tail[1] === 'number' && Number.isFinite(tail[1]) ? tail[0] : undefined;
    const ordered = [...(changes ?? [])].sort((a, b) => a.timeSec - b.timeSec);
    let previousHeater: number | undefined;
    const marks = ordered.flatMap((change) => {
        const value = change.values[role];
        if (value === undefined || !Number.isFinite(value) || !Number.isFinite(change.timeSec)) return [];
        // Clicking the heater that is already set is not another change label.
        if (role === 'heater' && previousHeater === value) return [];
        if (role === 'heater') previousHeater = value;
        if (tailTime != null && tailTime - change.timeSec < CONTROL_CHANGE_LABEL_DELAY_SEC) return [];
        return [mark(change.timeSec, value)];
    });
    if (tailTime != null && typeof tail?.[1] === 'number') marks.push(mark(tailTime, tail[1]));
    return {
        step: 'end' as const,
        markPoint: { silent: true, animation: false, data: marks },
    };
};

/** Stored reference behind the live curve. Same stroke as the live curve, at 30% opacity. Gaps stay broken. */
const referenceLineSeries = (
    name: string,
    xs: number[],
    values: readonly (number | null)[],
    style: CurveLineStyle,
    xAxisIndex: number,
    yAxisIndex: number,
) => ({
    id: `ref-${name}`,
    name,
    type: 'line' as const,
    xAxisIndex,
    yAxisIndex,
    z: 1,
    data: xs.map((x, i) => [x, values[i] ?? null]),
    connectNulls: false,
    lineStyle: { ...style },
    ...lineSeriesBase,
});

export interface TempSeriesParams {
    xs: number[];
    btActual: (number | null)[];
    etActual: (number | null)[];
    rorActual: (number | null)[];
    rorEtActual: (number | null)[];
    showTargetCurve: boolean;
    targetXs?: number[];
    targetBt?: (number | null)[];
    targetEt?: (number | null)[];
    targetRor?: (number | null)[];
    targetEtRor?: (number | null)[];
    showProfileBt?: boolean;
    showProfileEt?: boolean;
    showProfileRor?: boolean;
    showProfileEtRor?: boolean;
    showET: boolean;
    showRoR: boolean;
    showRoRET: boolean;
    curves: ResolvedCurveStyles;
    allMarkLines: object[];
    markPointData: object[];
    fcMarkArea: object | null;
    tempBottomBorderLine: object | null;
}

export const buildTempSeries = (params: TempSeriesParams): object[] => {
    const {
        xs,
        btActual,
        etActual,
        rorActual,
        rorEtActual,
        showTargetCurve,
        targetXs,
        targetBt,
        targetEt,
        targetRor,
        targetEtRor,
        showProfileBt = true,
        showProfileEt = true,
        showProfileRor = true,
        showProfileEtRor = true,
        showET,
        showRoR,
        showRoRET,
        curves,
        allMarkLines,
        markPointData,
        fcMarkArea,
        tempBottomBorderLine,
    } = params;

    return [
        showTargetCurve &&
            showProfileBt &&
            targetXs?.length &&
            hasNumericSample(targetBt) &&
            referenceLineSeries('BT Target', targetXs, targetBt ?? [], curves.bt.background, 0, 0),
        showTargetCurve &&
            showProfileEt &&
            targetXs?.length &&
            hasNumericSample(targetEt) &&
            referenceLineSeries('ET Target', targetXs, targetEt ?? [], curves.et.background, 0, 0),
        showTargetCurve &&
            showProfileRor &&
            targetXs?.length &&
            hasNumericSample(targetRor) &&
            referenceLineSeries('RoR Target', targetXs, targetRor ?? [], curves.ror.background, 0, 1),
        showTargetCurve &&
            showProfileEtRor &&
            targetXs?.length &&
            hasNumericSample(targetEtRor) &&
            referenceLineSeries('ET RoR Target', targetXs, targetEtRor ?? [], curves.etRor.background, 0, 1),
        {
            name: 'BT Actual',
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 0,
            z: 2,
            data: xs.map((x, i) => [x, btActual[i]]),
            lineStyle: { ...curves.bt.current },
            ...lineSeriesBase,
            markLine:
                allMarkLines.length > 0 || tempBottomBorderLine
                    ? {
                          silent: true,
                          symbol: ['none', 'none'],
                          symbolSize: 0,
                          data: tempBottomBorderLine ? [tempBottomBorderLine, ...allMarkLines] : allMarkLines,
                      }
                    : undefined,
            markPoint:
                markPointData.length > 0
                    ? {
                          silent: false,
                          data: markPointData,
                          animation: false,
                      }
                    : undefined,
            markArea: fcMarkArea ?? undefined,
        },
        showET && {
            name: 'ET Actual',
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 0,
            z: 2,
            data: xs.map((x, i) => [x, etActual[i]]),
            lineStyle: { ...curves.et.current },
            ...lineSeriesBase,
        },
        showRoR && {
            name: 'RoR',
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 1,
            data: xs.map((x, i) => [x, rorActual[i]]),
            lineStyle: { ...curves.ror.current },
            ...lineSeriesBase,
        },
        showRoR &&
            showRoRET && {
                name: 'ET RoR',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 1,
                data: xs.map((x, i) => [x, rorEtActual[i] ?? null]),
                lineStyle: { ...curves.etRor.current },
                ...lineSeriesBase,
            },
    ].filter(Boolean) as object[];
};

export interface ControlSeriesParams {
    controlData: ControlData;
    showTargetCurve: boolean;
    showProfileDrum?: boolean;
    showProfileHeat?: boolean;
    showProfileFan?: boolean;
    showControlDrum: boolean;
    showControlHeat: boolean;
    showControlFan: boolean;
    curves: ResolvedCurveStyles;
    controlGuideMarkLines: object[];
    fontScale?: number;
}

export const buildControlSeries = (params: ControlSeriesParams): object[] => {
    const {
        controlData,
        showTargetCurve,
        showProfileDrum = true,
        showProfileHeat = true,
        showProfileFan = true,
        showControlDrum,
        showControlHeat,
        showControlFan,
        curves,
        controlGuideMarkLines,
        fontScale = 1,
    } = params;
    const { xs: cxs, drumTemp, heatPower, fanSpeed, heatSet, heatTarget, reference, changes } = controlData;
    const series: object[] = [];

    // 참조(현재 곡선, 투명도 30%)를 먼저 깐다. Heat target / Heat set 은 별도 시리즈로 그 위에 남긴다.
    if (showTargetCurve && reference?.xs.length) {
        if (showProfileDrum && hasNumericSample(reference.drum)) {
            const data = reference.xs.map((x, i) => [x, reference.drum[i] ?? null] as [number, number | null]);
            series.push({
                ...referenceLineSeries('Drum Target', reference.xs, reference.drum, curves.drum.background, 1, 2),
                data,
                step: 'end' as const,
            });
        }
        if (showProfileHeat && hasNumericSample(reference.heater)) {
            const data = reference.xs.map((x, i) => [x, reference.heater[i] ?? null] as [number, number | null]);
            series.push({
                ...referenceLineSeries('Heater Target', reference.xs, reference.heater, curves.heat.background, 1, 3),
                data,
                step: 'end' as const,
            });
        }
        if (showProfileFan && hasNumericSample(reference.fan)) {
            const data = reference.xs.map((x, i) => [x, reference.fan[i] ?? null] as [number, number | null]);
            series.push({
                ...referenceLineSeries('Fan Target', reference.xs, reference.fan, curves.fan.background, 1, 3),
                data,
                step: 'end' as const,
            });
        }
    }

    if (showControlDrum) {
        const data = cxs.map((x, i) => [x, drumTemp[i]] as [number, number | null]);
        series.push({
            name: 'Drum',
            type: 'line' as const,
            color: curves.drum.current.color,
            xAxisIndex: 1,
            yAxisIndex: 2,
            data,
            lineStyle: { ...curves.drum.current },
            ...lineSeriesBase,
            ...controlMarks(data, changes, 'drum', curves.drum.current, fontScale),
        });
    }
    // 세트포인트(지시)는 실측보다 먼저 넣는다 — 겹치는 구간에서 실선(실측)이 점선을 덮어야 한다
    if (showControlHeat && heatTarget?.xs.length) {
        series.push({
            name: 'Heat target',
            type: 'line' as const,
            color: curves.heat.current.color,
            xAxisIndex: 1,
            yAxisIndex: 3,
            data: heatTarget.xs.map((x, i) => [x, heatTarget.values[i]]),
            lineStyle: { ...curves.heat.current, type: 'dotted' as const },
            ...lineSeriesBase,
            step: 'end' as const,
        });
    }
    if (showControlHeat && heatSet?.some((v) => v != null)) {
        series.push({
            name: 'Heat set',
            type: 'line' as const,
            color: curves.heat.current.color,
            xAxisIndex: 1,
            yAxisIndex: 3,
            data: cxs.map((x, i) => [x, heatSet[i]]),
            lineStyle: { ...curves.heat.current, type: 'dashed' as const },
            ...lineSeriesBase,
            step: 'end' as const,
        });
    }
    if (showControlHeat) {
        const data = cxs.map((x, i) => [x, heatPower[i]] as [number, number | null]);
        series.push({
            name: 'Heat',
            type: 'line' as const,
            color: curves.heat.current.color,
            xAxisIndex: 1,
            yAxisIndex: 3,
            data,
            lineStyle: { ...curves.heat.current },
            ...lineSeriesBase,
            ...controlMarks(data, changes, 'heater', curves.heat.current, fontScale),
        });
    }
    if (showControlFan) {
        const data = cxs.map((x, i) => [x, fanSpeed[i]] as [number, number | null]);
        series.push({
            name: 'Fan',
            type: 'line' as const,
            color: curves.fan.current.color,
            xAxisIndex: 1,
            yAxisIndex: 3,
            data,
            lineStyle: { ...curves.fan.current },
            ...lineSeriesBase,
            ...controlMarks(data, changes, 'fan', curves.fan.current, fontScale),
        });
    }
    const guideOwner = series.find((item) => ['Drum', 'Heat', 'Fan'].includes((item as { name: string }).name));
    if (guideOwner && controlGuideMarkLines.length > 0) {
        Object.assign(guideOwner, {
            markLine: {
                silent: true,
                symbol: ['none', 'none'] as [string, string],
                symbolSize: 0,
                data: controlGuideMarkLines,
            },
        });
    }
    return series;
};

/** BT 축 위에 이벤트 라벨. 한 번에 배치해서 박스가 겹치면 위/아래로 밀어낸다. */
export const buildCurveLabelSeries = (items: CurveLabelItem[], scale = 1, backgroundColor?: string) => ({
    id: 'event-curve-labels',
    name: 'Event curve labels',
    type: 'custom' as const,
    xAxisIndex: 0,
    yAxisIndex: 0,
    clip: false,
    silent: true,
    z: 10,
    tooltip: { show: false },
    // biome-ignore lint/suspicious/noExplicitAny: ECharts custom series API is loosely typed
    renderItem: (params: any, api: any) => {
        if (params.dataIndex !== 0) return;
        const { y: plotY, height: plotHeight } = params.coordSys;
        const laid = projectCurveLabels(items, (point) => api.coord(point), params.coordSys, scale);
        // Empty children are merged by index and leave the previous frame's text
        // (setOption notMerge:false while zooming). Returning nothing removes it.
        if (laid.length === 0) return;
        // biome-ignore lint/suspicious/noExplicitAny: ECharts graphic children
        const children: any[] = [];
        for (const box of laid) {
            const leader = curveLabelLeader(box);
            if (leader) {
                children.push({
                    type: 'line',
                    shape: leader,
                    style: { stroke: box.color, lineWidth: 1, opacity: box.opacity },
                });
            }
            if (box.showDot && box.anchorY >= plotY && box.anchorY <= plotY + plotHeight) {
                children.push({
                    type: 'circle',
                    shape: { cx: box.anchorX, cy: box.anchorY, r: scale === 1 ? 2.5 : scaleChartPx(3, scale) },
                    style: { fill: box.color, stroke: box.color, lineWidth: 1, opacity: box.opacity },
                });
            }
            children.push({
                type: 'text',
                x: box.x,
                y: box.textY,
                style: {
                    text: box.text,
                    backgroundColor,
                    fill: box.color,
                    opacity: box.opacity,
                    font: markerLabelFont(scale),
                    lineHeight: scaleChartPx(MARKER_LABEL_STACK_PX, scale),
                    textAlign: 'left',
                    textVerticalAlign: box.below ? 'top' : 'bottom',
                    width: box.right - box.left,
                },
            });
        }
        return { type: 'group', $mergeChildren: false, children };
    },
    data: [[0]],
});

export interface PhaseSeriesParams {
    phaseSegments: PhaseSegment[];
    tempMinC: number;
    tempMaxC: number;
    temperatureUnit: TemperatureUnit;
    colors: ResolvedChartColors;
    fontScale?: number;
}

/** ASCII advance at PHASE_BAR_FONT_SIZE. Same 6px step as marker labels. */
const phaseBarTextWidth = (text: string, fontSize: number) =>
    text.length * MARKER_LABEL_CHAR_WIDTH_PX * (fontSize / PHASE_BAR_FONT_SIZE);

export const phaseBarLabelMode = (
    width: number,
    name: string,
    durLabel: string,
    nameSize: number,
    narrowSize: number,
    textInset: number,
    gap: number,
    narrowThreshold: number,
): 'both' | 'time' | 'none' => {
    const nameWidth = phaseBarTextWidth(name, nameSize);
    const durWidth = phaseBarTextWidth(durLabel, nameSize);
    if (nameWidth + durWidth + textInset * 2 + gap <= width) return 'both';
    const narrowDurWidth = phaseBarTextWidth(durLabel, narrowSize);
    if (width > narrowThreshold && narrowDurWidth + textInset * 2 <= width) return 'time';
    return 'none';
};

// ── Phase bar (온도 plot 하단 오버레이) ───────────────────────────────
// 별도 grid 없이 temp grid(x0/y0) 하단에 custom series로 그린다.
// dataZoom/zoom 시 x는 축과 동기화, y는 coordSys 하단 고정 높이.
export const buildPhaseSeries = (params: PhaseSeriesParams) => {
    const { phaseSegments, tempMinC, tempMaxC, temperatureUnit, colors, fontScale = 1 } = params;
    const barHeight = scaleChartPx(PHASE_BAR_HEIGHT, fontScale);
    const narrowThreshold = scaleChartPx(PHASE_BAR_NARROW_THRESHOLD, fontScale);
    const labelGap = scaleChartPx(MARKER_LABEL_GAP_PX, fontScale);
    const textInset = scaleChartPx(PHASE_BAR_TEXT_INSET, fontScale);
    const nameSize = scaleChartPx(PHASE_BAR_FONT_SIZE, fontScale);
    const narrowSize = scaleChartPx(PHASE_BAR_FONT_SIZE_NARROW, fontScale);
    const strokeWidth = fontScale === 1 ? PHASE_BAR_STROKE_WIDTH : PHASE_BAR_STROKE_WIDTH * fontScale;
    // y=0이 temp 축 min(기본 50°C) 밖일 수 있어 x 변환용 mid Y 사용
    const phaseCoordY = (toDisplayTemp(tempMinC, temperatureUnit) + toDisplayTemp(tempMaxC, temperatureUnit)) / 2;

    return {
        type: 'custom' as const,
        xAxisIndex: 0,
        yAxisIndex: 0,

        // biome-ignore lint/suspicious/noExplicitAny: ECharts custom series API is loosely typed
        renderItem: (renderParams: any, api: any) => {
            const startPx = api.coord([api.value(0), phaseCoordY])[0] as number;
            const endPx = api.coord([api.value(1), phaseCoordY])[0] as number;
            const { x: csX, y: csY, width: csW, height: csH } = renderParams.coordSys;
            const barY = csY + csH - barHeight;
            const clipped = echarts.graphic.clipRectByRect(
                {
                    x: startPx,
                    y: barY,
                    width: Math.max(0, endPx - startPx),
                    height: barHeight,
                },
                { x: csX, y: csY, width: csW, height: csH },
            );
            if (!clipped) return;

            const durSec = api.value(2) as number;
            const pct = api.value(3) as number;
            const color = api.value(4) as string;
            const name = api.value(5) as string;
            const durLabel = `${formatElapsed(durSec)}  ${pct}%`;
            const { x, y, width, height: h } = clipped;
            const textY = y + h / 2;

            // biome-ignore lint/suspicious/noExplicitAny: ECharts graphic children are loosely typed
            const children: any[] = [
                {
                    type: 'rect',
                    shape: clipped,
                    style: {
                        fill: color,
                        stroke: colors.phaseBarStroke,
                        lineWidth: strokeWidth,
                    },
                    silent: true,
                },
            ];

            // 둘 다 들어가면 이름 좌 + 시간 우. 시간만 들어가면 중앙. 그것도 못 들어가면 생략.
            const labelMode = phaseBarLabelMode(
                width,
                name,
                durLabel,
                nameSize,
                narrowSize,
                textInset,
                labelGap,
                narrowThreshold,
            );
            if (labelMode === 'both') {
                children.push({
                    type: 'text',
                    style: {
                        text: name,
                        x: x + textInset,
                        y: textY,
                        fontSize: nameSize,
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
                        x: x + width - textInset,
                        y: textY,
                        fontSize: nameSize,
                        fontFamily: PHASE_BAR_FONT_FAMILY,
                        fill: colors.phaseBarDuration,
                        textAlign: 'right',
                        textVerticalAlign: 'middle',
                    },
                    silent: true,
                });
            } else if (labelMode === 'time') {
                children.push({
                    type: 'text',
                    style: {
                        text: durLabel,
                        x: x + width / 2,
                        y: textY,
                        fontSize: narrowSize,
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
    };
};
