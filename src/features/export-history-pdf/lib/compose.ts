import { roastPdfLayout } from '@shared/lib/roast-pdf-layout';
import { createElement } from 'react';
import type { ComposeHistoryPdfInput } from './types';

/** Rasterize only the chart at 200 dpi; the document text stays vector. */
export const historyPdfChartBox = () => ({
    width: Math.round((roastPdfLayout.chartWidth * 200) / 72),
    height: Math.round((roastPdfLayout.chartHeight * 200) / 72),
});

export const composeHistoryPdf = async (input: ComposeHistoryPdfInput): Promise<Uint8Array> => {
    const [{ pdf }, { HistoryPdfDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('../ui/HistoryPdfDocument'),
    ]);
    const blob = await pdf(
        createElement(HistoryPdfDocument, { ...input, logoSrc: `${import.meta.env.BASE_URL}logo.png` }),
    ).toBlob();
    return new Uint8Array(await blob.arrayBuffer());
};
