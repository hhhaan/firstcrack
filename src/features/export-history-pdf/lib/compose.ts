import { createElement } from 'react';
import type { ComposeHistoryPdfInput } from './types';

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
