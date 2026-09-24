import type { PhaseSegment, TemperatureUnit } from '@features/active-roast';
import {
    CONTROL_GRID_BOTTOM,
    PHASE_BAR_FONT_FAMILY,
    PHASE_BAR_FONT_SIZE,
    PHASE_BAR_FONT_SIZE_NARROW,
    PHASE_BAR_FONT_WEIGHT,
    PHASE_BAR_HEIGHT,
    PHASE_BAR_NARROW_THRESHOLD,
    PHASE_BAR_STROKE_WIDTH,
    PHASE_BAR_TEXT_INSET,
    PHASE_BAR_WIDE_THRESHOLD,
} from '@features/active-roast/lib/chart-config';
import { toDisplayTemp } from '@features/active-roast/lib/temperature';
import { formatElapsed } from '@shared/lib/format';
import * as echarts from 'echarts';
import { type CurveLabelItem, layoutCurveLabelBoxes, MARKER_LABEL_MAX_WIDTH_PX } from './markers';
import type { ControlData, ResolvedChartColors } from './types';

// 커피 로스팅 차트에 최적화된 스무딩 설정
// - BT(Bean Temp): 0.4 → 실측 느낌 유지, 과한 곡선화 방지
// - ET(Environment Temp): 0.35 → BT보다 약간 덜 휘게
// - RoR(Rate of Rise): 0.25 → 센서 노이즈 많아서 상대적으로 더 부드럽게
// - smoothMonotone 'x' → 시간축 방향으로만 스무딩 (역행 방지)
// - sampling 'lttb' → Largest-Triangle-Three-Buckets 알고리즘 (성능 + 품질)
export const getSmoothConfig = (strength: number = 0.4) => ({
    smooth: strength,
    smoothMonotone: 'x' as const,
    sampling: 'lttb' as const,
});

export const lineSeriesBase = {
    showSymbol: false,
    emphasis: { disabled: true },
};

export interface TempSeriesParams {
    xs: number[];
    btActual: (number | null)[];
    etActual: (number | null)[];
    rorActual: (number | null)[];
    rorEtActual: (number | null)[];
    showTargetCurve: boolean;
    targetXs?: number[];
    targetBt?: (number | null)[];
    showET: boolean;
    showRoR: boolean;
    showRoRET: boolean;
    colors: ResolvedChartColors;
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
        showET,
        showRoR,
        showRoRET,
        colors,
        allMarkLines,
        markPointData,
        fcMarkArea,
        tempBottomBorderLine,
    } = params;

    return [
        showTargetCurve &&
            targetXs?.length &&
            targetBt?.length && {
                name: 'BT Target',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                z: 1,
                data: targetXs.map((x, i) => [x, targetBt[i] ?? null]),
                lineStyle: { color: colors.btTarget, width: 0.8, type: 'dashed' },
                ...lineSeriesBase,
                smooth: false,
            },
        {
            name: 'BT Actual',
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 0,
            z: 2,
            data: xs.map((x, i) => [x, btActual[i]]),
            lineStyle: { color: colors.btActual, width: 1.2 },
            ...lineSeriesBase,
            ...getSmoothConfig(0.4),
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
            lineStyle: { color: colors.etActual, width: 0.9 },
            ...lineSeriesBase,
            ...getSmoothConfig(0.35),
        },
        showRoR && {
            name: 'RoR',
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 1,
            data: xs.map((x, i) => [x, rorActual[i]]),
            lineStyle: { color: colors.rorActual, width: 0.9 },
            ...lineSeriesBase,
            ...getSmoothConfig(0.25),
        },
        showRoR &&
            showRoRET && {
                name: 'ET RoR',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 1,
                data: xs.map((x, i) => [x, rorEtActual[i] ?? null]),
                lineStyle: { color: colors.etActual, width: 0.9, type: 'dashed' },
                ...lineSeriesBase,
                ...getSmoothConfig(0.25),
            },
    ].filter(Boolean) as object[];
};

export interface ControlSeriesParams {
    controlData: ControlData;
    showControlDrum: boolean;
    showControlHeat: boolean;
    showControlFan: boolean;
    colors: ResolvedChartColors;
    controlGuideMarkLines: object[];
}

export const buildControlSeries = (params: ControlSeriesParams): object[] => {
    const { controlData, showControlDrum, showControlHeat, showControlFan, colors, controlGuideMarkLines } = params;
    const { xs: cxs, drumTemp, heatPower, fanSpeed, heatSet } = controlData;
    const series: object[] = [];

    if (showControlDrum) {
        series.push({
            name: 'Drum',
            type: 'line' as const,
            color: colors.controlDrum,
            xAxisIndex: 1,
            yAxisIndex: 2,
            data: cxs.map((x, i) => [x, drumTemp[i]]),
            lineStyle: { color: colors.controlDrum, width: 1 },
            ...lineSeriesBase,
            smooth: 0.3,
        });
    }
    // 세트포인트(지시)는 실측보다 먼저 넣는다 — 겹치는 구간에서 실선(실측)이 점선을 덮어야 한다
    if (showControlHeat && heatSet?.some((v) => v != null)) {
        series.push({
            name: 'Heat set',
            type: 'line' as const,
            color: colors.controlHeat,
            xAxisIndex: 1,
            yAxisIndex: 3,
            data: cxs.map((x, i) => [x, heatSet[i]]),
            lineStyle: { color: colors.controlHeat, width: 1, type: 'dashed' as const },
            ...lineSeriesBase,
            step: 'end' as const,
            smooth: false,
        });
    }
    if (showControlHeat) {
        series.push({
            name: 'Heat',
            type: 'line' as const,
            color: colors.controlHeat,
            xAxisIndex: 1,
            yAxisIndex: 3,
            data: cxs.map((x, i) => [x, heatPower[i]]),
            lineStyle: { color: colors.controlHeat, width: 1 },
            ...lineSeriesBase,
            step: 'end' as const,
            smooth: false,
        });
    }
    if (showControlFan) {
        series.push({
            name: 'Fan',
            type: 'line' as const,
            color: colors.controlFan,
            xAxisIndex: 1,
            yAxisIndex: 3,
            data: cxs.map((x, i) => [x, fanSpeed[i]]),
            lineStyle: { color: colors.controlFan, width: 1 },
            ...lineSeriesBase,
            step: 'end' as const,
            smooth: false,
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

export const buildContinuousMarkerSeries = (
    lines: { timeSec: number; color: string; width: number }[],
    tempYMid: number,
    hasControlSeries: boolean,
) => ({
    id: 'event-marker-lines',
    name: 'Event marker lines',
    type: 'custom' as const,
    xAxisIndex: 0,
    yAxisIndex: 0,
    clip: false,
    silent: true,
    z: 3,
    // biome-ignore lint/suspicious/noExplicitAny: ECharts custom series API is loosely typed
    renderItem: (params: any, api: any) => {
        const x = api.coord([api.value(0), tempYMid])[0] as number;
        const { x: plotX, y: plotY, width: plotWidth, height: plotHeight } = params.coordSys;
        if (!Number.isFinite(x) || x < plotX || x > plotX + plotWidth) return;
        return {
            type: 'line',
            shape: {
                x1: x,
                y1: plotY,
                x2: x,
                y2: hasControlSeries ? api.getHeight() - CONTROL_GRID_BOTTOM : plotY + plotHeight,
            },
            // Keep CSS colors outside ECharts numeric data dimensions.
            style: { stroke: lines[params.dataIndex].color, lineWidth: lines[params.dataIndex].width },
            silent: true,
        };
    },
    data: lines.map(({ timeSec, color, width }) => [timeSec, color, width]),
});

/** BT 축 위에 이벤트 라벨. 한 번에 배치해서 박스가 겹치면 위/아래로 밀어낸다. */
export const buildCurveLabelSeries = (items: CurveLabelItem[]) => ({
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
        const { x: plotX, width: plotWidth } = params.coordSys;
        const laid = layoutCurveLabelBoxes(
            items.flatMap((item) => {
                const point = api.coord([item.timeSec, item.y]) as number[];
                if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return [];
                if (point[0] < plotX || point[0] > plotX + plotWidth) return [];
                return [
                    {
                        timeSec: item.timeSec,
                        xPx: point[0],
                        yPx: point[1],
                        text: item.text,
                        below: item.below,
                        color: item.color,
                        showDot: item.showDot,
                    },
                ];
            }),
            api.getWidth(),
        );
        // biome-ignore lint/suspicious/noExplicitAny: ECharts graphic children
        const children: any[] = [];
        for (const box of laid) {
            if (box.showDot) {
                children.push({
                    type: 'circle',
                    shape: { cx: box.anchorX, cy: box.anchorY, r: 2.5 },
                    style: { fill: box.color, stroke: box.color, lineWidth: 1 },
                });
            }
            children.push({
                type: 'text',
                x: box.x,
                y: box.textY,
                style: {
                    text: box.text,
                    fill: box.color,
                    font: '600 10px monospace',
                    textAlign: 'left',
                    textVerticalAlign: box.below ? 'top' : 'bottom',
                    width: Math.min(MARKER_LABEL_MAX_WIDTH_PX, api.getWidth() - 8),
                    overflow: 'truncate',
                },
            });
        }
        return { type: 'group', children };
    },
    data: [[0]],
});

export interface PhaseSeriesParams {
    phaseSegments: PhaseSegment[];
    tempMinC: number;
    tempMaxC: number;
    temperatureUnit: TemperatureUnit;
    colors: ResolvedChartColors;
}

// ── Phase bar (온도 plot 하단 오버레이) ───────────────────────────────
// 별도 grid 없이 temp grid(x0/y0) 하단에 custom series로 그린다.
// dataZoom/zoom 시 x는 축과 동기화, y는 coordSys 하단 고정 높이.
export const buildPhaseSeries = (params: PhaseSeriesParams) => {
    const { phaseSegments, tempMinC, tempMaxC, temperatureUnit, colors } = params;
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
    };
};
