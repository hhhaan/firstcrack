import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pdf as createPdf, Font } from '@react-pdf/renderer';
import { createElement } from 'react';
import { expect, it } from 'vitest';
import { HistoryPdfDocument } from '../ui/HistoryPdfDocument';

it('renders a long Korean title, chart and legend on one portrait A4 page', async () => {
    Font.clear();
    Font.register({
        family: 'Helvetica',
        src: fileURLToPath(new URL('../../../../public/fonts/SUIT-Regular.ttf', import.meta.url)),
    });
    Font.register({
        family: 'SUIT',
        fonts: [
            {
                src: fileURLToPath(new URL('../../../../public/fonts/SUIT-Regular.ttf', import.meta.url)),
                fontWeight: 400,
            },
            {
                src: fileURLToPath(new URL('../../../../public/fonts/SUIT-SemiBold.ttf', import.meta.url)),
                fontWeight: 600,
            },
        ],
    });
    Font.register({
        family: 'Noto PDF',
        src: fileURLToPath(new URL('../../../../public/fonts/NotoSansJP-Regular.woff', import.meta.url)),
    });
    const blob = await createPdf(
        createElement(HistoryPdfDocument, {
            logoSrc: fileURLToPath(new URL('../../../../public/logo.png', import.meta.url)),
            title: '에티오피아 日本 中国 éñ '.repeat(20),
            date: '26-10-31 14:35',
            chartDataUrl: `data:image/png;base64,${readFileSync(new URL('../../../../public/logo.png', import.meta.url)).toString('base64')}`,
            legend: [{ label: 'BT (°C)', color: '#009d4c', lineType: 'dashed' }],
        }),
    ).toBlob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const pdf = new TextDecoder('latin1').decode(bytes);
    const fallback = Font.getFont({ fontFamily: 'Noto PDF' }).data;
    for (const character of '日本中国エチオピアéñ') {
        expect(fallback?.hasGlyphForCodePoint(character.codePointAt(0) ?? 0)).toBe(true);
    }
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1);
    const mediaBox = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf);
    expect(Number(mediaBox?.[1])).toBeCloseTo(595.28, 2);
    expect(Number(mediaBox?.[2])).toBeCloseTo(841.89, 2);
    expect(pdf).toContain('/FontFile2');
    expect(pdf).toContain('/ca 0.5');
    expect(pdf).toContain('/Subtype /Image');
});
