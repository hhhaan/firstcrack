import { dataUrlToBytes } from '@shared/lib/pdf-page';

/** 200 dpi A4 landscape (297mm × 210mm). */
export const HISTORY_PDF_PAGE_PX = { width: 2339, height: 1654 } as const;
/** 12mm at 200 dpi. */
export const HISTORY_PDF_MARGIN_PX = 94;

const COLOR_PRIMARY = '#101828';
const COLOR_MUTED = '#4a5565';
const COLOR_BORDER = '#e5e7eb';
const FONT_FAMILY = 'Inter, SUIT, system-ui, sans-serif';
const FONT_UI = `500 30px ${FONT_FAMILY}`;
const FONT_VALUE = `500 42px ${FONT_FAMILY}`;

export type HistoryPdfHeader = {
    bean: string;
    roastTitle?: string;
    batchNumbers?: string;
    date: string;
    duration: string;
    charge: string;
    drop: string;
    labels: {
        bean: string;
        roastTitle?: string;
        batchNumbers?: string;
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

export const HISTORY_PDF_HEADER_PX = 400;
export const HISTORY_PDF_LEGEND_PX = 80;
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
 * Paint a header, chart and optional series legend onto an A4 landscape JPEG.
 * Unicode comes from canvas, not PDF fonts.
 */
export const composeHistoryPdfJpeg = async (
    input: ComposeHistoryPdfInput,
): Promise<{ jpeg: Uint8Array; width: number; height: number }> => {
    // Explicitly load both bundled fonts: canvas text alone does not trigger font loading.
    await Promise.all([
        document.fonts.load('500 30px Inter'),
        document.fonts.load('600 56px Inter'),
        document.fonts.load('500 30px SUIT'),
        document.fonts.load('600 56px SUIT'),
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
    ctx.font = `600 30px ${FONT_FAMILY}`;
    ctx.fillStyle = COLOR_PRIMARY;
    ctx.fillText('FIRST CRACK', margin, margin);
    ctx.font = FONT_UI;
    ctx.fillStyle = COLOR_MUTED;
    ctx.textAlign = 'right';
    ctx.fillText(fitText(ctx, input.title ?? 'Roast profile', innerW - 340), width - margin, margin);
    ctx.textAlign = 'left';
    line(margin + 56);

    ctx.font = `600 56px ${FONT_FAMILY}`;
    ctx.fillStyle = COLOR_PRIMARY;
    const heading = (input.header.roastTitle ?? input.header.bean).replace(/\s+/g, ' ').trim();
    let beanY = margin + 154;
    if (ctx.measureText(heading).width <= innerW) {
        ctx.fillText(heading, margin, margin + 76);
    } else {
        const chars = Array.from(heading);
        let end = chars.length;
        while (end > 1 && ctx.measureText(chars.slice(0, end).join('')).width > innerW) end--;
        // Prefer a word boundary, while still wrapping unspaced CJK names.
        const first = chars.slice(0, end).join('');
        const space = first.lastIndexOf(' ');
        if (space > first.length / 2) end = Array.from(first.slice(0, space)).length;
        ctx.fillText(chars.slice(0, end).join(''), margin, margin + 76);
        ctx.fillText(fitText(ctx, chars.slice(end).join('').trim(), innerW), margin, margin + 144);
        beanY += 68;
    }

    if (input.header.roastTitle != null) {
        ctx.font = FONT_UI;
        ctx.fillStyle = COLOR_MUTED;
        const label = fitText(ctx, input.header.labels.bean, innerW / 4);
        ctx.fillText(label, margin, beanY);
        const valueX = margin + ctx.measureText(label).width + 20;
        ctx.fillStyle = COLOR_PRIMARY;
        ctx.fillText(fitText(ctx, input.header.bean, width - margin - valueX), valueX, beanY);
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
            ctx.fillRect(x - 24, margin + 280, 2, 88);
        }
        ctx.fillStyle = COLOR_MUTED;
        ctx.font = FONT_UI;
        ctx.fillText(fitText(ctx, field.label, colW - 48), x, margin + 280);
        ctx.fillStyle = COLOR_PRIMARY;
        ctx.font = FONT_VALUE;
        ctx.fillText(fitText(ctx, field.value, colW - 48), x, margin + 326);
    });
    line(margin + HISTORY_PDF_HEADER_PX - 20);

    const hasLegend = Boolean(input.legend?.length);
    const chartBox = historyPdfChartBox(hasLegend);
    const chartTop = margin + HISTORY_PDF_HEADER_PX;
    const chart = await loadImage(input.chartDataUrl);
    ctx.drawImage(chart, margin, chartTop, chartBox.width, chartBox.height);

    if (input.legend?.length) {
        let lx = margin;
        const ly = chartTop + chartBox.height + 16;
        ctx.font = FONT_UI;
        const labelWidths = input.legend.map((item) => ctx.measureText(item.label).width);
        const labelSpace = innerW - input.legend.length * 52 - (input.legend.length - 1) * 40;
        const labelScale = Math.min(1, labelSpace / labelWidths.reduce((sum, value) => sum + value, 0));
        for (const [i, item] of input.legend.entries()) {
            const labelWidth = labelWidths[i] * labelScale;
            ctx.save();
            ctx.globalAlpha = item.opacity ?? 1;
            ctx.strokeStyle = item.color;
            ctx.lineWidth = 5;
            ctx.setLineDash(legendLineDash(item));
            ctx.beginPath();
            ctx.moveTo(lx, ly + 18);
            ctx.lineTo(lx + 40, ly + 18);
            ctx.stroke();
            ctx.restore();
            ctx.fillStyle = COLOR_MUTED;
            ctx.fillText(fitText(ctx, item.label, labelWidth), lx + 52, ly);
            lx += 52 + labelWidth + 40;
        }
    }

    const footerY = height - margin - HISTORY_PDF_FOOTER_PX;
    line(footerY + 20);
    ctx.font = FONT_UI;
    ctx.fillStyle = COLOR_MUTED;
    const footer = input.header.batchNumbers
        ? `${input.header.labels.batchNumbers ? `${input.header.labels.batchNumbers}: ` : ''}${input.header.batchNumbers}`
        : 'First Crack';
    ctx.fillText(fitText(ctx, footer, innerW - 128), margin, footerY + 44);
    ctx.textAlign = 'right';
    ctx.fillText('1 / 1', width - margin, footerY + 44);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.98);
    return { jpeg: dataUrlToBytes(dataUrl), width, height };
};
