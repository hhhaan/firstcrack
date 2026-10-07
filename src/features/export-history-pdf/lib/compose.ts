import { dataUrlToBytes } from '@shared/lib/pdf-page';

/** 200 dpi A4 landscape (297mm × 210mm). */
export const HISTORY_PDF_PAGE_PX = { width: 2339, height: 1654 } as const;
/** 12mm at 200 dpi. */
export const HISTORY_PDF_MARGIN_PX = 94;

const COLOR_PRIMARY = '#171717';
const COLOR_MUTED = '#777169';
const COLOR_BORDER = '#e5e5e5';
const FONT_FAMILY = 'Inter, SUIT, system-ui, sans-serif';
const FONT_UI = `500 24px ${FONT_FAMILY}`;
const FONT_VALUE = `500 36px ${FONT_FAMILY}`;

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

export type HistoryPdfLegendItem = {
    color: string;
    label: string;
    lineType?: 'solid' | 'dashed' | 'dotted';
    opacity?: number;
};

const legendLineDash = (item: HistoryPdfLegendItem): number[] => {
    const type = item.lineType ?? 'solid';
    if (type === 'dotted') return [4, 6];
    if (type === 'dashed') return [10, 6];
    return [];
};

export type ComposeHistoryPdfInput = {
    title?: string;
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

/** Bound text by measured glyphs; never cut a surrogate pair or silently clip it. */
const fitText = (ctx: CanvasRenderingContext2D, value: string, width: number) => {
    const chars = Array.from(value);
    if (ctx.measureText(value).width <= width) return value;
    while (chars.length && ctx.measureText(`${chars.join('')}…`).width > width) chars.pop();
    return `${chars.join('')}…`;
};

export const HISTORY_PDF_HEADER_PX = 364;
export const HISTORY_PDF_LEGEND_PX = 64;
export const HISTORY_PDF_FOOTER_PX = 80;

export const historyPdfChartBox = (hasLegend: boolean) => {
    const { width, height } = HISTORY_PDF_PAGE_PX;
    const margin = HISTORY_PDF_MARGIN_PX;
    return {
        width: width - margin * 2,
        height:
            height -
            margin * 2 -
            HISTORY_PDF_HEADER_PX -
            HISTORY_PDF_FOOTER_PX -
            (hasLegend ? HISTORY_PDF_LEGEND_PX : 0),
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
    // Explicitly load both bundled fonts: canvas text alone does not trigger font loading.
    await Promise.all([
        document.fonts.load('500 24px Inter'),
        document.fonts.load('600 54px Inter'),
        document.fonts.load('500 24px SUIT'),
        document.fonts.load('600 54px SUIT'),
    ]);
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
    const line = (y: number) => {
        ctx.fillStyle = COLOR_BORDER;
        ctx.fillRect(margin, y, innerW, 2);
    };
    ctx.font = `600 24px ${FONT_FAMILY}`;
    ctx.fillStyle = COLOR_PRIMARY;
    ctx.fillText('FIRST CRACK', margin, margin);
    ctx.font = FONT_UI;
    ctx.fillStyle = COLOR_MUTED;
    ctx.textAlign = 'right';
    ctx.fillText(input.title ?? 'Roast profile', width - margin, margin);
    ctx.textAlign = 'left';
    line(margin + 48);

    ctx.fillStyle = COLOR_MUTED;
    ctx.font = FONT_UI;
    ctx.fillText(input.header.labels.bean, margin, margin + 76);
    ctx.font = `600 54px ${FONT_FAMILY}`;
    ctx.fillStyle = COLOR_PRIMARY;
    const bean = input.header.bean.replace(/\s+/g, ' ').trim();
    if (ctx.measureText(bean).width <= innerW) {
        ctx.fillText(bean, margin, margin + 113);
    } else {
        const chars = Array.from(bean);
        let end = chars.length;
        while (end > 1 && ctx.measureText(chars.slice(0, end).join('')).width > innerW) end--;
        // Prefer a word boundary, while still wrapping unspaced CJK names.
        const first = chars.slice(0, end).join('');
        const space = first.lastIndexOf(' ');
        if (space > first.length / 2) end = Array.from(first.slice(0, space)).length;
        ctx.fillText(chars.slice(0, end).join(''), margin, margin + 113);
        ctx.fillText(fitText(ctx, chars.slice(end).join('').trim(), innerW), margin, margin + 177);
    }

    const fields = [
        { label: input.header.labels.date, value: input.header.date },
        { label: input.header.labels.duration, value: input.header.duration },
        { label: input.header.labels.charge, value: input.header.charge },
        { label: input.header.labels.drop, value: input.header.drop },
    ];
    const colW = innerW / fields.length;
    fields.forEach((field, i) => {
        const x = margin + i * colW;
        if (i) {
            ctx.fillStyle = COLOR_BORDER;
            ctx.fillRect(x - 28, margin + 258, 2, 68);
        }
        ctx.fillStyle = COLOR_MUTED;
        ctx.font = FONT_UI;
        ctx.fillText(fitText(ctx, field.label, colW - 56), x, margin + 252);
        ctx.fillStyle = COLOR_PRIMARY;
        ctx.font = FONT_VALUE;
        ctx.fillText(fitText(ctx, field.value, colW - 56), x, margin + 288);
    });

    const hasLegend = Boolean(input.legend?.length);
    const chartBox = historyPdfChartBox(hasLegend);
    const chartTop = margin + HISTORY_PDF_HEADER_PX;
    const chart = await loadImage(input.chartDataUrl);
    ctx.drawImage(chart, margin, chartTop, chartBox.width, chartBox.height);

    if (input.legend?.length) {
        let lx = margin;
        const ly = chartTop + chartBox.height + 16;
        ctx.font = FONT_UI;
        // The export supplies at most seven series; equal slots keep long translations bounded.
        const slot = innerW / input.legend.length;
        for (const item of input.legend) {
            ctx.save();
            ctx.globalAlpha = item.opacity ?? 1;
            ctx.strokeStyle = item.color;
            ctx.lineWidth = 4;
            ctx.setLineDash(legendLineDash(item));
            ctx.beginPath();
            ctx.moveTo(lx, ly + 14);
            ctx.lineTo(lx + 40, ly + 14);
            ctx.stroke();
            ctx.restore();
            ctx.fillStyle = COLOR_MUTED;
            ctx.fillText(fitText(ctx, item.label, slot - 76), lx + 52, ly);
            lx += slot;
        }
    }

    const footerY = height - margin - HISTORY_PDF_FOOTER_PX;
    line(footerY + 20);
    ctx.font = FONT_UI;
    ctx.fillStyle = COLOR_MUTED;
    ctx.fillText('First Crack', margin, footerY + 44);
    ctx.textAlign = 'right';
    ctx.fillText('1 / 1', width - margin, footerY + 44);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.98);
    return { jpeg: dataUrlToBytes(dataUrl), width, height };
};
