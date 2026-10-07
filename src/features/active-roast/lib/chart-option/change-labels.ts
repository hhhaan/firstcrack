import { formatControlValue } from '../control-channels';

export interface ChangePoint {
    x: number;
    value: number;
    text: string;
}

export interface FindChangePointsOptions {
    /** Minimum numeric delta from the last labeled value before a new label is placed. */
    deadband?: number;
}

/** % axes use a fixed 0.5 so 1-point steps label; non-% use 0.5% of span (min 0.05). */
export const changeLabelDeadband = (min: number, max: number, unit?: string) => {
    if (unit === '%') return 0.5;
    const span = max - min;
    if (!Number.isFinite(span) || span <= 0) return 0.05;
    return Math.max(span * 0.005, 0.05);
};

/**
 * Samples whose displayed value differs from the previous non-null sample, after deadband.
 * The first reading counts. Null gaps never read as 0.
 */
export const findChangePoints = (
    xs: readonly number[],
    values: readonly (number | null)[],
    options?: FindChangePointsOptions,
): ChangePoint[] => {
    const deadband = options?.deadband ?? 0;
    const points: ChangePoint[] = [];
    let previous: string | null = null;
    let lastLabeledValue: number | null = null;
    for (let i = 0; i < xs.length; i++) {
        const value = values[i];
        const text = formatControlValue(value);
        if (text == null || value == null || !Number.isFinite(xs[i])) continue;
        if (lastLabeledValue != null && Math.abs(value - lastLabeledValue) < deadband) continue;
        if (text !== previous) {
            points.push({ x: xs[i], value, text });
            lastLabeledValue = value;
        }
        previous = text;
    }
    return points;
};

type ValuesKey = readonly (number | null)[];
const changePointCache = new WeakMap<readonly number[], WeakMap<ValuesKey, Map<number, ChangePoint[]>>>();

export const memoizedChangePoints = (
    xs: readonly number[],
    values: readonly (number | null)[],
    deadband: number,
): ChangePoint[] => {
    let byValues = changePointCache.get(xs);
    if (!byValues) {
        byValues = new WeakMap();
        changePointCache.set(xs, byValues);
    }
    let byDeadband = byValues.get(values);
    if (!byDeadband) {
        byDeadband = new Map();
        byValues.set(values, byDeadband);
    }
    let cached = byDeadband.get(deadband);
    if (!cached) {
        cached = findChangePoints(xs, values, { deadband });
        byDeadband.set(deadband, cached);
    }
    return cached;
};

export const sliceVisibleChangePoints = (points: readonly ChangePoint[], xMin: number, xMax: number) => {
    if (points.length === 0 || xMax < xMin) return [];
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (points[mid].x < xMin) lo = mid + 1;
        else hi = mid;
    }
    const start = lo;
    hi = points.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (points[mid].x <= xMax) lo = mid + 1;
        else hi = mid;
    }
    return points.slice(start, lo);
};

export interface ChangeLabelCandidate {
    xPx: number;
    yPx: number;
    text: string;
    color: string;
    channel: string;
}

export interface PlacedChangeLabel extends ChangeLabelCandidate {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface PlotRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export const CHANGE_LABEL_FONT_SIZE = 10;
export const CHANGE_LABEL_CHAR_WIDTH_PX = 6;
export const CHANGE_LABEL_HEIGHT_PX = 12;
/** Same-channel labels closer than this are skipped, so bursts of changes stay sparse. */
export const CHANGE_LABEL_CHANNEL_GAP_PX = 56;
const OFFSET_PX = 3;
const GAP_PX = 2;

const overlaps = (a: PlacedChangeLabel, b: Pick<PlacedChangeLabel, 'left' | 'top' | 'width' | 'height'>) =>
    a.left < b.left + b.width + GAP_PX &&
    b.left < a.left + a.width + GAP_PX &&
    a.top < b.top + b.height + GAP_PX &&
    b.top < a.top + a.height + GAP_PX;

/**
 * Newest first, so the most recent changes keep their labels when space runs out.
 * Each label tries above-right, below-right, above-left, below-left of its point and
 * must stay inside the plot. Anything that would overlap a placed label is dropped,
 * and one channel never places two labels closer than CHANGE_LABEL_CHANNEL_GAP_PX.
 * ponytail: greedy O(n²) over visible change points; fine for a few hundred, add a sweep line if it grows.
 */
export const layoutChangeLabels = (
    candidates: readonly ChangeLabelCandidate[],
    rect: PlotRect,
    charWidthPx = CHANGE_LABEL_CHAR_WIDTH_PX,
    heightPx = CHANGE_LABEL_HEIGHT_PX,
): PlacedChangeLabel[] => {
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const inside = candidates.filter(
        (c) =>
            Number.isFinite(c.xPx) &&
            Number.isFinite(c.yPx) &&
            c.xPx >= rect.x &&
            c.xPx <= right &&
            c.yPx >= rect.y &&
            c.yPx <= bottom,
    );
    const ordered = [...inside].sort((a, b) => b.xPx - a.xPx);
    const placed: PlacedChangeLabel[] = [];
    const lastXByChannel = new Map<string, number>();
    for (const c of ordered) {
        const width = c.text.length * charWidthPx + 2;
        const lastX = lastXByChannel.get(c.channel);
        if (lastX != null && lastX - c.xPx < Math.max(width + GAP_PX, CHANGE_LABEL_CHANNEL_GAP_PX)) continue;
        const spots = [
            { left: c.xPx + OFFSET_PX, top: c.yPx - OFFSET_PX - heightPx },
            { left: c.xPx + OFFSET_PX, top: c.yPx + OFFSET_PX },
            { left: c.xPx - OFFSET_PX - width, top: c.yPx - OFFSET_PX - heightPx },
            { left: c.xPx - OFFSET_PX - width, top: c.yPx + OFFSET_PX },
        ];
        const spot = spots
            .map((s) => ({ ...c, ...s, width, height: heightPx }))
            .find(
                (box) =>
                    box.left >= rect.x &&
                    box.left + box.width <= right &&
                    box.top >= rect.y &&
                    box.top + box.height <= bottom &&
                    !placed.some((other) => overlaps(other, box)),
            );
        if (!spot) continue;
        placed.push(spot);
        lastXByChannel.set(c.channel, c.xPx);
    }
    return placed;
};

export interface ChangeLabelChannel {
    channel: string;
    color: string;
    points: ChangePoint[];
    /** Axis range the channel's curve is drawn against. */
    min: number;
    max: number;
}

export interface ChangeLabelSeriesOptions {
    haloColor: string;
    xDomain: { min: number; max: number };
}

/**
 * One custom series for every channel so the collision pass sees all labels at once.
 * Y is mapped from each channel's own axis range; x follows the shared control x-axis.
 */
export const buildChangeLabelSeries = (
    channels: ChangeLabelChannel[],
    { haloColor, xDomain }: ChangeLabelSeriesOptions,
) => ({
    id: 'control-change-labels',
    name: 'Control change labels',
    type: 'custom' as const,
    xAxisIndex: 1,
    yAxisIndex: 2,
    clip: false,
    silent: true,
    z: 6,
    tooltip: { show: false },
    // biome-ignore lint/suspicious/noExplicitAny: ECharts custom series API is loosely typed
    renderItem: (params: any, api: any) => {
        if (params.dataIndex !== 0) return;
        const rect = params.coordSys as PlotRect;
        const span = xDomain.max - xDomain.min;
        const dataXAt = (px: number) => (span <= 0 ? xDomain.min : xDomain.min + ((px - rect.x) / rect.width) * span);
        const visMin = dataXAt(rect.x);
        const visMax = dataXAt(rect.x + rect.width);
        const candidates = channels.flatMap(({ channel, color, points, min, max }) => {
            const visible = sliceVisibleChangePoints(points, visMin, visMax);
            const yDenom = max - min;
            return visible.map((point) => {
                const ratio = yDenom <= 0 ? 0 : (point.value - min) / yDenom;
                return {
                    channel,
                    color,
                    text: point.text,
                    xPx: (api.coord([point.x, min]) as number[])[0],
                    yPx: rect.y + rect.height * (1 - ratio),
                };
            });
        });
        const laid = layoutChangeLabels(candidates, rect);
        if (laid.length === 0) return;
        return {
            type: 'group',
            $mergeChildren: false,
            children: laid.flatMap((label) => [
                {
                    type: 'circle',
                    shape: { cx: label.xPx, cy: label.yPx, r: 2 },
                    style: { fill: label.color },
                },
                {
                    type: 'text',
                    x: label.left + 1,
                    y: label.top,
                    style: {
                        text: label.text,
                        fill: label.color,
                        font: `600 ${CHANGE_LABEL_FONT_SIZE}px monospace`,
                        stroke: haloColor,
                        lineWidth: 3,
                        strokeFirst: true,
                        textAlign: 'left',
                        textVerticalAlign: 'top',
                    },
                },
            ]),
        };
    },
    data: [[0]],
});
