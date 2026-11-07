import { CHART_LABEL_Z } from '@features/active-roast/lib/chart-config';
import { roastPdfLayout } from '@shared/lib/roast-pdf-layout';
import { type CustomSeriesOption, format } from 'echarts';
import type { CurveLabelItem } from './markers';

export const buildPrintEventLabels = (items: CurveLabelItem[]): CustomSeriesOption => {
    const font = `400 ${roastPdfLayout.tickFontSize}px ${roastPdfLayout.fontFamily}`;
    const lineHeight = roastPdfLayout.tickFontSize;
    const leaderGap = 10;
    return {
        id: 'event-curve-labels',
        name: 'Event curve labels',
        type: 'custom',
        xAxisIndex: 0,
        yAxisIndex: 0,
        silent: true,
        clip: false,
        z: CHART_LABEL_Z,
        tooltip: { show: false },
        data: items.length ? [[0]] : [],
        renderItem: (params, api) => {
            if (params.dataIndex !== 0) return;
            const plot = params.coordSys;
            if (
                !('x' in plot && typeof plot.x === 'number') ||
                !('y' in plot && typeof plot.y === 'number') ||
                !('width' in plot && typeof plot.width === 'number') ||
                !('height' in plot && typeof plot.height === 'number')
            )
                return;
            const { x: plotLeft, y: plotTop, width, height } = plot;
            const right = plotLeft + width;
            const bottom = plotTop + height;
            const placed: { left: number; right: number; top: number; bottom: number }[] = [];
            const chronologicalItems = [...items].sort((a, b) => a.timeSec - b.timeSec);
            let preferBelow = false;
            return {
                type: 'group',
                children: chronologicalItems.flatMap((item) => {
                    const [anchorX, anchorY] = api.coord([item.timeSec, item.y]);
                    if (
                        !Number.isFinite(anchorX) ||
                        !Number.isFinite(anchorY) ||
                        anchorX < plotLeft ||
                        anchorX > right ||
                        anchorY < plotTop ||
                        anchorY > bottom
                    )
                        return [];
                    const bounds = format.getTextRect(item.text, font, 'left', 'top', 0, undefined, false, lineHeight);
                    const preferredLeft =
                        anchorX + leaderGap + bounds.width <= right
                            ? anchorX + leaderGap
                            : anchorX - leaderGap - bounds.width;
                    const left = Math.max(plotLeft + 4, Math.min(preferredLeft, right - bounds.width - 4));
                    const preferredTop = preferBelow ? anchorY + leaderGap : anchorY - leaderGap - bounds.height;
                    const clampTop = (value: number) =>
                        Math.max(plotTop + 4, Math.min(value, bottom - bounds.height - 4));
                    const candidates = Array.from({ length: items.length * 2 + 1 }, (_, offset) =>
                        [preferBelow, !preferBelow].map((below) =>
                            below
                                ? anchorY + leaderGap + offset * (bounds.height + 4)
                                : anchorY - leaderGap - bounds.height - offset * (bounds.height + 4),
                        ),
                    ).flat();
                    const top =
                        candidates.find(
                            (top) =>
                                top >= plotTop + 4 &&
                                top + bounds.height <= bottom - 4 &&
                                !placed.some(
                                    (box) =>
                                        left < box.right + 4 &&
                                        left + bounds.width + 4 > box.left &&
                                        top < box.bottom + 4 &&
                                        top + bounds.height + 4 > box.top,
                                ),
                        ) ?? clampTop(preferredTop);
                    preferBelow = top < anchorY;
                    placed.push({ left, right: left + bounds.width, top, bottom: top + bounds.height });
                    return [
                        {
                            type: 'line' as const,
                            shape: {
                                x1: anchorX,
                                y1: anchorY,
                                x2: Math.max(left, Math.min(anchorX, left + bounds.width)),
                                y2: Math.max(top, Math.min(anchorY, top + bounds.height)),
                            },
                            style: { stroke: item.color, lineWidth: 0.7 },
                        },
                        {
                            type: 'text' as const,
                            x: left,
                            y: top,
                            style: {
                                text: item.text,
                                font,
                                lineHeight,
                                align: 'left' as const,
                                verticalAlign: 'top' as const,
                                fill: item.color,
                            },
                        },
                    ];
                }),
            };
        },
    };
};
