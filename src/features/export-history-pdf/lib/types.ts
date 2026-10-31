export type HistoryPdfLegendItem = {
    color: string;
    label: string;
    lineType?: 'solid' | 'dashed' | 'dotted';
};

export type ComposeHistoryPdfInput = {
    title: string;
    date: string;
    chartDataUrl: string;
    legend: HistoryPdfLegendItem[];
};
