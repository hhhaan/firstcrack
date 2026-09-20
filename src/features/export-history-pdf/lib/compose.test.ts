import { describe, expect, it } from 'vitest';
import { HISTORY_PDF_LEGEND_PX, HISTORY_PDF_MARGIN_PX, HISTORY_PDF_PAGE_PX, historyPdfChartBox } from './compose';

describe('historyPdfChartBox', () => {
    it('sizes the leftover A4 area for temp + control grids', () => {
        const withLegend = historyPdfChartBox(true);
        const without = historyPdfChartBox(false);
        expect(withLegend.width).toBe(HISTORY_PDF_PAGE_PX.width - HISTORY_PDF_MARGIN_PX * 2);
        expect(without.height - withLegend.height).toBe(HISTORY_PDF_LEGEND_PX);
        expect(withLegend.height).toBeGreaterThan(1000);
    });
});
