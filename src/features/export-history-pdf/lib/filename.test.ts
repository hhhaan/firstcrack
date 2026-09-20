import { formatDateShort } from '@shared/lib/format';
import { describe, expect, it } from 'vitest';
import { historyPdfFilename } from './filename';

describe('historyPdfFilename', () => {
    it('slugs the bean and uses the roast calendar day', () => {
        const roastedAt = '2026-09-20T12:00:00Z';
        expect(historyPdfFilename('E2E Ethiopia', roastedAt)).toBe(
            `roast-graph-e2e-ethiopia-${formatDateShort(roastedAt)}.pdf`,
        );
    });

    it('falls back when bean or date is missing', () => {
        expect(historyPdfFilename(null, null)).toBe('roast-graph-roast-undated.pdf');
    });

    it('keeps CJK letters in the slug', () => {
        const roastedAt = '2026-09-20T12:00:00Z';
        expect(historyPdfFilename('에티오피아', roastedAt)).toBe(
            `roast-graph-에티오피아-${formatDateShort(roastedAt)}.pdf`,
        );
    });
});
