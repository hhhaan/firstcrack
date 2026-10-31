import { createElement } from 'react';
import type { ComposeHistoryPdfInput } from './types';

/** Rasterize only the chart at 200 dpi; the document text stays vector. */
export const historyPdfChartBox = () => ({ width: 1409, height: 1444 });

export const composeHistoryPdf = async (input: ComposeHistoryPdfInput): Promise<Uint8Array> => {
    const [{ pdf }, { HistoryPdfDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('../ui/HistoryPdfDocument'),
    ]);
    const blob = await pdf(createElement(HistoryPdfDocument, input)).toBlob();
    return new Uint8Array(await blob.arrayBuffer());
};
