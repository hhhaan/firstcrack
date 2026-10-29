// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    it('keeps the chart proportions on a portrait A4 page', () => {
        const withLegend = historyPdfChartBox(true);
        const without = historyPdfChartBox(false);
        expect(withLegend.width).toBe(HISTORY_PDF_PAGE_PX.width - HISTORY_PDF_MARGIN_PX * 2);
        expect(without.height - withLegend.height).toBe(HISTORY_PDF_LEGEND_PX);
        expect(withLegend.height).toBeGreaterThan(900);
        expect(HISTORY_PDF_PAGE_PX).toEqual({ width: 1654, height: 2339 });
        expect(withLegend.height / withLegend.width).toBeLessThan(0.8);
        expect(
            withLegend.height +
                HISTORY_PDF_MARGIN_PX * 2 +
                HISTORY_PDF_HEADER_PX +
                HISTORY_PDF_LEGEND_PX +
                HISTORY_PDF_FOOTER_PX,
        ).toBeLessThanOrEqual(HISTORY_PDF_PAGE_PX.height);
    });
});

const ctx = {
    font: '',
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    measureText: (value: string) => ({
        width: Array.from(value).reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 30 : 18), 0),
    }),
    setLineDash: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
};
const load = vi.fn().mockResolvedValue([]);
const textFonts: string[] = [];

beforeEach(() => {
    vi.clearAllMocks();
    textFonts.length = 0;
    ctx.fillText.mockImplementation(() => textFonts.push(ctx.font));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/2Q==');
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
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

it.each([false, true])('wraps the heading and keeps A4 bounds with an independent roast title=%s', async (hasTitle) => {
    const bean = '에티오피아 예가체프 내추럴 스페셜티 '.repeat(10);
    const result = await composeHistoryPdfJpeg({
        header: {
            bean: hasTitle ? 'Green B' : bean,
            ...(hasTitle ? { roastTitle: bean } : {}),
            batchNumbers: '#9 · PR #13',
            date: '2026-10-25 14:35',
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
    expect(ctx.fillText).toHaveBeenCalledWith('배치 번호: #9 · PR #13', expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith('2026-10-25 14:35', expect.any(Number), expect.any(Number));
    expect(result).toMatchObject(HISTORY_PDF_PAGE_PX);
    const titleLines = ctx.fillText.mock.calls.filter(
        ([, , y]) => y === HISTORY_PDF_MARGIN_PX + 60 || y === HISTORY_PDF_MARGIN_PX + 116,
    );
    expect(titleLines).toHaveLength(2);
    expect(titleLines[1][0]).toMatch(/…$/);
    const date = ctx.fillText.mock.calls.find(([text]) => text === '2026-10-25 14:35');
    expect(date).toBeDefined();
    expect(date?.[2]).toBeGreaterThan(titleLines[1][2] + 100);
    if (hasTitle) {
        expect(ctx.fillText).toHaveBeenCalledWith('Green B', expect.any(Number), expect.any(Number));
    }
    const headerRuleY = HISTORY_PDF_MARGIN_PX + HISTORY_PDF_HEADER_PX - 4;
    const metadata = ctx.fillText.mock.calls.filter(([, , y]) => y >= HISTORY_PDF_MARGIN_PX + 226 && y < headerRuleY);
    expect(metadata).toHaveLength(8);
    for (let i = 0; i < metadata.length; i += 2) {
        const [label, x] = metadata[i];
        const [value, valueX] = metadata[i + 1];
        expect(valueX).toBeGreaterThan(x + ctx.measureText(label).width);
        expect(valueX + ctx.measureText(value).width).toBeLessThanOrEqual(
            x + (HISTORY_PDF_PAGE_PX.width - HISTORY_PDF_MARGIN_PX * 2) / 2,
        );
    }
    for (const [text, x, y] of ctx.fillText.mock.calls) {
        expect(x).toBeGreaterThanOrEqual(HISTORY_PDF_MARGIN_PX);
        expect(y).toBeLessThan(HISTORY_PDF_PAGE_PX.height - HISTORY_PDF_MARGIN_PX);
        expect(ctx.measureText(text).width).toBeLessThanOrEqual(HISTORY_PDF_PAGE_PX.width - HISTORY_PDF_MARGIN_PX * 2);
    }
    for (const font of textFonts) {
        const pixels = Number(/(\d+)px/.exec(font)?.[1]);
        expect((pixels * 72) / 200).toBeGreaterThanOrEqual(10);
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

it('bounds long report and batch labels away from the brand and page number without a legend', async () => {
    await composeHistoryPdfJpeg({
        title: 'Roast history '.repeat(30),
        header: {
            bean: 'Ethiopia',
            batchNumbers: '#9 · PR #13 '.repeat(30),
            date: '2026-10-25 14:35',
            duration: '10:42',
            charge: '195°C',
            drop: '208°C',
            labels: { bean: 'Bean', date: 'Date', duration: 'Duration', charge: 'Charge', drop: 'Drop' },
        },
        chartDataUrl: 'data:image/png;base64,AA==',
    });
    const report = ctx.fillText.mock.calls.find(([text]) => text.startsWith('Roast history'));
    const batch = ctx.fillText.mock.calls.find(([text]) => text.startsWith('#9'));
    expect(report).toBeDefined();
    expect(batch).toBeDefined();
    expect(report?.[0]).toMatch(/…$/);
    expect(batch?.[0]).toMatch(/…$/);
    const innerW = HISTORY_PDF_PAGE_PX.width - HISTORY_PDF_MARGIN_PX * 2;
    expect(ctx.measureText(report?.[0] ?? '').width).toBeLessThanOrEqual(innerW - 340);
    expect(ctx.measureText(batch?.[0] ?? '').width).toBeLessThanOrEqual(innerW - 128);
    expect(batch?.[0]).not.toMatch(/^:/);
    expect(ctx.drawImage).toHaveBeenCalledWith(
        expect.anything(),
        HISTORY_PDF_MARGIN_PX,
        HISTORY_PDF_MARGIN_PX + HISTORY_PDF_HEADER_PX,
        historyPdfChartBox(false).width,
        historyPdfChartBox(false).height,
    );
});

it('keeps a wide translated legend label readable beside shorter series labels', async () => {
    const labels = ['BT (°C)', 'ET (°C)', 'RoR (°C/min)', 'ターゲットカーブ', 'Drum', 'Heat', 'Fan'];
    await composeHistoryPdfJpeg({
        header: {
            bean: 'Ethiopia',
            date: '2026-10-25 14:35',
            duration: '10:42',
            charge: '195°C',
            drop: '208°C',
            labels: { bean: 'Bean', date: 'Date', duration: 'Duration', charge: 'Charge', drop: 'Drop' },
        },
        chartDataUrl: 'data:image/png;base64,AA==',
        legend: labels.map((label) => ({ label, color: '#009d4c' })),
    });
    for (const label of labels) {
        expect(ctx.fillText).toHaveBeenCalledWith(label, expect.any(Number), expect.any(Number));
    }
    const legendY = HISTORY_PDF_MARGIN_PX + HISTORY_PDF_HEADER_PX + historyPdfChartBox(true).height + 16;
    const entries = ctx.fillText.mock.calls.filter(([, , y]) => y >= legendY && y < legendY + HISTORY_PDF_LEGEND_PX);
    expect(new Set(entries.map(([, , y]) => y)).size).toBe(2);
    const rowEnds = new Map<number, number>();
    for (const [text, x, y] of entries) {
        const end = rowEnds.get(y) ?? HISTORY_PDF_MARGIN_PX;
        expect(x).toBeGreaterThan(end);
        const nextEnd = x + ctx.measureText(text).width;
        expect(nextEnd).toBeLessThanOrEqual(HISTORY_PDF_PAGE_PX.width - HISTORY_PDF_MARGIN_PX);
        rowEnds.set(y, nextEnd);
    }
});
