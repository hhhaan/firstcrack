import { roastPdfLayout } from '@shared/lib/roast-pdf-layout';
import { type CustomSeriesOption, format } from 'echarts';
import type { CurveLabelItem } from './markers';

type PrintCurve = { xs: number[]; values: (number | null)[] } & (
    | { axis: 'temperature' }
    | { axis: 'ror'; min: number; max: number }
);

export const buildPrintEventLabels = (items: CurveLabelItem[], curves: PrintCurve[] = []): CustomSeriesOption => {
    const font = `400 ${roastPdfLayout.tickFontSize}px ${roastPdfLayout.fontFamily}`;
    const lineHeight = roastPdfLayout.tickFontSize;
    return {
        id: 'event-curve-labels',
        name: 'Event curve labels',
        type: 'custom',
        xAxisIndex: 0,
        yAxisIndex: 0,
        silent: true,
        clip: false,
        z: 10,
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
            const curveBounds = curves.flatMap((curve) =>
                curve.values.flatMap((value, index) => {
                    const previous = curve.values[index - 1];
                    if (value == null || previous == null || !Number.isFinite(value) || !Number.isFinite(previous))
                        return [];
                    const [x1, temperatureY1] = api.coord([curve.xs[index - 1], previous]);
                    const [x2, temperatureY2] = api.coord([curve.xs[index], value]);
                    const y1 =
                        curve.axis === 'temperature'
                            ? temperatureY1
                            : plotTop + height * (1 - (previous - curve.min) / (curve.max - curve.min));
                    const y2 =
                        curve.axis === 'temperature'
                            ? temperatureY2
                            : plotTop + height * (1 - (value - curve.min) / (curve.max - curve.min));
                    return [
                        {
                            left: Math.min(x1, x2),
                            right: Math.max(x1, x2),
                            top: Math.min(y1, y2),
                            bottom: Math.max(y1, y2),
                        },
                    ];
                }),
            );
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
                        anchorX + 18 + bounds.width <= right ? anchorX + 18 : anchorX - 18 - bounds.width;
                    const left = Math.max(plotLeft + 4, Math.min(preferredLeft, right - bounds.width - 4));
                    const preferredTop = preferBelow ? anchorY + 18 : anchorY - 18 - bounds.height;
                    const clampTop = (value: number) =>
                        Math.max(plotTop + 4, Math.min(value, bottom - bounds.height - 4));
                    const candidates = [preferBelow, !preferBelow].flatMap((below) => {
                        const positions = Array.from({ length: items.length * 2 + 1 }, (_, offset) =>
                            below
                                ? anchorY + 18 + offset * (bounds.height + 4)
                                : anchorY - 18 - bounds.height - offset * (bounds.height + 4),
                        );
                        const edge = below ? bottom - bounds.height - 4 : plotTop + 4;
                        if (below ? edge >= anchorY + 18 : edge + bounds.height <= anchorY - 18) positions.push(edge);
                        return positions;
                    });
                    const occupied = [...placed, ...curveBounds];
                    const top =
                        candidates.find(
                            (top) =>
                                top >= plotTop + 4 &&
                                top + bounds.height <= bottom - 4 &&
                                !occupied.some(
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
