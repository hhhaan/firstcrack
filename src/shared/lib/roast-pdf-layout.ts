const margin = 28.8;

export const roastPdfLayout = {
    pageWidth: 595.28,
    pageHeight: 841.89,
    margin,
    chartWidth: 595.28 - margin * 2,
    chartHeight: 624.84,
    plotGap: margin / 2,
    fontFamily: 'SUIT',
    tickFontSize: 8,
} as const;
