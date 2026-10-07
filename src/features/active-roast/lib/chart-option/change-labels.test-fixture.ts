export type ChangeLabelRenderChild = {
    style?: { text?: string; fill?: string };
    x?: number;
};

type ChangeLabelSeries = {
    id?: string;
    renderItem?: (params: unknown, api: unknown) => { children?: ChangeLabelRenderChild[] };
};

export const renderChangeLabels = (
    option: { series?: unknown },
    coord: (x: number) => [number, number],
    plot: { width: number; height: number } = { width: 600, height: 80 },
): ChangeLabelRenderChild[] => {
    const seriesList = Array.isArray(option.series) ? option.series : [];
    const labelSeries = (seriesList as ChangeLabelSeries[]).find((series) => series.id === 'control-change-labels');
    const rendered = labelSeries?.renderItem?.(
        { dataIndex: 0, coordSys: { x: 0, y: 0, width: plot.width, height: plot.height } },
        { coord: ([x]: number[]) => coord(x) },
    );
    return rendered?.children ?? [];
};

export const zoomWindowCoord =
    (xViewMin: number, xViewMax: number, width = 600, height = 80) =>
    (x: number): [number, number] => [((x - xViewMin) / (xViewMax - xViewMin)) * width, height / 2];

export const fullTimelineCoord =
    (xMax: number, width = 600, y = 40) =>
    (x: number): [number, number] => [(x / xMax) * width, y];
