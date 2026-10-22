// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    composeHistoryPdfJpeg,
    HISTORY_PDF_FOOTER_PX,
    HISTORY_PDF_HEADER_PX,
    HISTORY_PDF_LEGEND_PX,
    HISTORY_PDF_MARGIN_PX,
    HISTORY_PDF_PAGE_PX,
    historyPdfChartBox,
} from './compose';

describe('historyPdfChartBox', () => {
    it('sizes the leftover A4 area for temp + control grids', () => {
        const withLegend = historyPdfChartBox(true);
        const without = historyPdfChartBox(false);
        expect(withLegend.width).toBe(HISTORY_PDF_PAGE_PX.width - HISTORY_PDF_MARGIN_PX * 2);
        expect(without.height - withLegend.height).toBe(HISTORY_PDF_LEGEND_PX);
        expect(withLegend.height).toBeGreaterThan(900);
        expect(
            withLegend.height +
                HISTORY_PDF_MARGIN_PX * 2 +
                HISTORY_PDF_HEADER_PX +
                HISTORY_PDF_LEGEND_PX +
                HISTORY_PDF_FOOTER_PX,
        ).toBe(HISTORY_PDF_PAGE_PX.height);
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

it.each([false, true])('wraps the heading and keeps A4 bounds with an independent roast title=%s', async (hasTitle) => {
    const ctx = {
        fillRect: vi.fn(),
        fillText: vi.fn(),
        drawImage: vi.fn(),
        measureText: (value: string) => ({ width: Array.from(value).length * 30 }),
        setLineDash: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/2Q==');
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    vi.stubGlobal(
        'Image',
        class {
            onload: (() => void) | null = null;
            set src(_value: string) {
                this.onload?.();
            }
        },
    );
    const bean = '에티오피아 예가체프 내추럴 스페셜티 '.repeat(10);
    const result = await composeHistoryPdfJpeg({
        header: {
            bean: hasTitle ? 'Green B' : bean,
            ...(hasTitle ? { roastTitle: bean } : {}),
            batchNumbers: '#9 · Σ#13',
            date: '2026-09-21',
            duration: '10:42',
            charge: '195°C',
            drop: '208°C',
            labels: {
                bean: '원두',
                roastTitle: hasTitle ? '배치명' : undefined,
                batchNumbers: '배치 번호',
                date: '날짜',
                duration: '로스팅 시간',
                charge: '투입 온도',
                drop: '배출 온도',
            },
        },
        chartDataUrl: 'data:image/png;base64,AA==',
        legend: [{ label: 'BT (°C)', color: '#009d4c' }],
    });
    expect(load).toHaveBeenCalledTimes(4);
    expect(ctx.fillText).toHaveBeenCalledWith('배치 번호: #9 · Σ#13', expect.any(Number), expect.any(Number));
    expect(result).toMatchObject(HISTORY_PDF_PAGE_PX);
    const titleLines = ctx.fillText.mock.calls.filter(
        ([, , y]) => y === HISTORY_PDF_MARGIN_PX + 113 || y === HISTORY_PDF_MARGIN_PX + 177,
    );
    expect(titleLines).toHaveLength(2);
    expect(titleLines[1][0]).toMatch(/…$/);
    if (hasTitle) {
        expect(ctx.fillText).toHaveBeenCalledWith('배치명', expect.any(Number), expect.any(Number));
        expect(ctx.fillText).toHaveBeenCalledWith('Green B', expect.any(Number), expect.any(Number));
    }
    for (const [text, x, y] of ctx.fillText.mock.calls) {
        expect(x).toBeGreaterThanOrEqual(HISTORY_PDF_MARGIN_PX);
        expect(y).toBeLessThan(HISTORY_PDF_PAGE_PX.height - HISTORY_PDF_MARGIN_PX);
        expect(ctx.measureText(text).width).toBeLessThanOrEqual(HISTORY_PDF_PAGE_PX.width - HISTORY_PDF_MARGIN_PX * 2);
    }
    const box = historyPdfChartBox(true);
    expect(ctx.drawImage).toHaveBeenCalledWith(
        expect.anything(),
        HISTORY_PDF_MARGIN_PX,
        HISTORY_PDF_MARGIN_PX + HISTORY_PDF_HEADER_PX,
        box.width,
        box.height,
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
        '1 / 1',
        HISTORY_PDF_PAGE_PX.width - HISTORY_PDF_MARGIN_PX,
        expect.any(Number),
    );
});
