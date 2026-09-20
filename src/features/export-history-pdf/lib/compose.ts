import { dataUrlToBytes } from '@shared/lib/pdf-page';

/** 200 dpi A4 landscape (297mm × 210mm). */
export const HISTORY_PDF_PAGE_PX = { width: 2339, height: 1654 } as const;
/** 12mm at 200 dpi. */
export const HISTORY_PDF_MARGIN_PX = 94;

const COLOR_PRIMARY = '#171717';
const COLOR_MUTED = '#777169';
const FONT_UI = '500 11px Inter, SUIT, system-ui, sans-serif';
const FONT_VALUE = '500 16px Inter, SUIT, system-ui, sans-serif';
const FONT_MONO = '500 16px monospace';

export type HistoryPdfHeader = {
    bean: string;
    date: string;
    duration: string;
    charge: string;
    drop: string;
    labels: {
        bean: string;
        date: string;
        duration: string;
        charge: string;
        drop: string;
    };
};

export type HistoryPdfLegendItem = { color: string; label: string };

export type ComposeHistoryPdfInput = {
    header: HistoryPdfHeader;
    chartDataUrl: string;
    legend?: HistoryPdfLegendItem[];
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('composeHistoryPdfJpeg: chart image failed to load'));
        img.src = src;
    });

const drawLabelValue = (
    ctx: CanvasRenderingContext2D,
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
    valueFont: string,
) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, 48);
    ctx.clip();
    ctx.fillStyle = COLOR_MUTED;
    ctx.font = FONT_UI;
    ctx.fillText(label.toUpperCase(), x, y);
    ctx.fillStyle = COLOR_PRIMARY;
    ctx.font = valueFont;
    ctx.fillText(value, x, y + 18);
    ctx.restore();
};

/** Header row under the 12mm margin. */
export const HISTORY_PDF_HEADER_PX = 64;
export const HISTORY_PDF_LEGEND_PX = 28;

export const historyPdfChartBox = (hasLegend: boolean) => {
    const { width, height } = HISTORY_PDF_PAGE_PX;
    const margin = HISTORY_PDF_MARGIN_PX;
    return {
        width: width - margin * 2,
        height: height - margin * 2 - HISTORY_PDF_HEADER_PX - (hasLegend ? HISTORY_PDF_LEGEND_PX : 0),
    };
};

/**
 * Paint header + chart (+ optional Drum/Heat/Fan legend) onto an A4 landscape
 * JPEG. Unicode comes from canvas, not PDF fonts.
 * The chart image fills the leftover box so the control band stays ~21% of that area.
 */
export const composeHistoryPdfJpeg = async (
    input: ComposeHistoryPdfInput,
): Promise<{ jpeg: Uint8Array; width: number; height: number }> => {
    const { width, height } = HISTORY_PDF_PAGE_PX;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('composeHistoryPdfJpeg: 2d canvas unavailable');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = 'top';

    const margin = HISTORY_PDF_MARGIN_PX;
    const innerW = width - margin * 2;
    const headerY = margin;
    const shares = [1.4, 1, 1, 1, 1];
    const shareSum = shares.reduce((a, b) => a + b, 0);
    const colW = shares.map((s) => (s / shareSum) * innerW);
    const fields: { label: string; value: string; mono: boolean }[] = [
        { label: input.header.labels.bean, value: input.header.bean, mono: false },
        { label: input.header.labels.date, value: input.header.date, mono: true },
        { label: input.header.labels.duration, value: input.header.duration, mono: true },
        { label: input.header.labels.charge, value: input.header.charge, mono: true },
        { label: input.header.labels.drop, value: input.header.drop, mono: true },
    ];
    let x = margin;
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        drawLabelValue(ctx, field.label, field.value, x, headerY, colW[i] - 16, field.mono ? FONT_MONO : FONT_VALUE);
        x += colW[i];
    }

    const hasLegend = Boolean(input.legend?.length);
    const chartBox = historyPdfChartBox(hasLegend);
    const chartTop = margin + HISTORY_PDF_HEADER_PX;
    const chart = await loadImage(input.chartDataUrl);
    ctx.drawImage(chart, margin, chartTop, chartBox.width, chartBox.height);

    if (input.legend?.length) {
        let lx = margin + 8;
        const ly = height - margin - 18;
        for (const item of input.legend) {
            ctx.fillStyle = item.color;
            ctx.fillRect(lx, ly + 6, 16, 2);
            ctx.fillStyle = COLOR_MUTED;
            ctx.font = FONT_UI;
            ctx.fillText(item.label, lx + 20, ly);
            lx += 20 + ctx.measureText(item.label).width + 24;
        }
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    return { jpeg: dataUrlToBytes(dataUrl), width, height };
};
