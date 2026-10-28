import { type CurveLabelBox, type CurveLabelItem, clampCurveLabelY, layoutCurveLabelBoxes } from './markers';

interface PlotRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ProjectedCurveLabel extends CurveLabelBox {
    item: CurveLabelItem;
}

/** Rendering and pointer hit-testing must cull and pack exactly the same labels. */
export const projectCurveLabels = (
    items: CurveLabelItem[],
    coord: (point: number[]) => number[],
    plot: PlotRect,
    scale = 1,
): ProjectedCurveLabel[] => {
    if (!(plot.width > 0 && plot.height > 0)) return [];
    const projected = items.flatMap((item) => {
        const [x, y] = coord([item.timeSec, item.y]);
        const anchorY = clampCurveLabelY(y, plot.y, plot.height) ?? (item.labelAtTop ? y : null);
        if (!Number.isFinite(x) || anchorY == null || !Number.isFinite(anchorY)) return [];
        if (x < plot.x || x > plot.x + plot.width) return [];
        return [
            {
                item,
                timeSec: item.timeSec,
                xPx: x,
                yPx: anchorY,
                text: item.text,
                below: item.below,
                color: item.color,
                opacity: item.opacity,
                showDot: item.showDot,
                showLeader: item.showLeader,
                topInsetPx: item.topInsetPx,
                labelTopPx: item.labelAtTop ? plot.y : undefined,
            },
        ];
    });
    return layoutCurveLabelBoxes(projected, plot.x + plot.width, scale, plot.y + plot.height, {
        left: plot.x,
        top: plot.y,
    }).map((box, index) => ({ ...box, item: projected[index].item }));
};

/** Connect the immutable curve anchor to the nearest edge of the final text box. */
export const curveLabelLeader = (box: CurveLabelBox) => {
    if (!box.showLeader || !box.text || box.bottom <= box.top) return null;
    const x = Math.max(box.left, Math.min(box.anchorX, box.right));
    const y = Math.max(box.top, Math.min(box.anchorY, box.bottom));
    if (x === box.anchorX && y === box.anchorY) return null;
    return { x1: box.anchorX, y1: box.anchorY, x2: x, y2: y };
};

export const isCurveLabelLeaderHit = (box: CurveLabelBox, x: number, y: number, threshold: number) => {
    const line = curveLabelLeader(box);
    if (!line) return false;
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    const ratio = Math.max(0, Math.min(1, ((x - line.x1) * dx + (y - line.y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - line.x1 - ratio * dx, y - line.y1 - ratio * dy) <= threshold;
};
