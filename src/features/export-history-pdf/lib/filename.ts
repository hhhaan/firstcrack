import { formatDateShort } from '@shared/lib/format';

const slug = (value: string): string =>
    value
        .normalize('NFC')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .toLowerCase();

export const historyPdfFilename = (bean: string | null, roastedAt: string | null): string => {
    const name = slug(bean ?? '') || 'roast';
    const date = formatDateShort(roastedAt);
    const day = date === '—' ? 'undated' : date;
    return `roast-graph-${name}-${day}.pdf`;
};
