// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runExportHistoryPdf } from './useExportHistoryPdf';

const { confirm, downloadPdf, compose, jpegToPdf, join, downloadDir } = vi.hoisted(() => ({
    confirm: vi.fn(),
    downloadPdf: vi.fn(),
    compose: vi.fn(),
    jpegToPdf: vi.fn(),
    join: vi.fn(),
    downloadDir: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm }));
vi.mock('@tauri-apps/api/path', () => ({ join, downloadDir }));
vi.mock('@shared/lib/download', () => ({ downloadPdf }));
vi.mock('@shared/lib/pdf-page', () => ({ jpegToLandscapeA4Pdf: jpegToPdf }));
vi.mock('./lib/compose', () => ({ composeHistoryPdfJpeg: compose }));

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const input = {
    filename: 'roast-graph-ethiopia-26-09-20.pdf',
    chartDataUrl: 'data:image/jpeg;base64,xx',
    header: {
        bean: 'Ethiopia',
        date: '26-09-20',
        duration: '11:20',
        charge: '185.0°C',
        drop: '210.0°C',
        labels: { bean: 'Bean', date: 'Date', duration: 'Duration', charge: 'Charge', drop: 'Drop' },
    },
};
const labels = {
    title: 'First Crack',
    okLabel: 'Export',
    cancelLabel: 'Cancel',
    confirmMessage: (path: string) => `save ${path}`,
};

describe('runExportHistoryPdf', () => {
    beforeEach(() => {
        confirm.mockReset();
        downloadPdf.mockReset();
        compose.mockReset();
        jpegToPdf.mockReset();
        join.mockReset();
        downloadDir.mockReset();
        compose.mockResolvedValue({ jpeg, width: 2339, height: 1654 });
        jpegToPdf.mockReturnValue(pdf);
        downloadDir.mockResolvedValue('/downloads');
        join.mockResolvedValue('/downloads/roast-graph-ethiopia-26-09-20.pdf');
        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
        Reflect.deleteProperty(window, '__TAURI__');
    });

    const markTauri = () => {
        Object.assign(window, { __TAURI_INTERNALS__: {} });
    };

    it('downloads without a Tauri confirm in the Vite browser', async () => {
        await expect(runExportHistoryPdf(input, labels)).resolves.toBe(true);
        expect(downloadDir).not.toHaveBeenCalled();
        expect(confirm).not.toHaveBeenCalled();
        expect(downloadPdf).toHaveBeenCalledWith(pdf, input.filename);
    });

    it('writes the PDF after confirm in Tauri', async () => {
        markTauri();
        confirm.mockResolvedValue(true);
        await expect(runExportHistoryPdf(input, labels)).resolves.toBe(true);
        expect(jpegToPdf).toHaveBeenCalledWith(jpeg, 2339, 1654);
        expect(confirm).toHaveBeenCalledWith('save /downloads/roast-graph-ethiopia-26-09-20.pdf', {
            title: 'First Crack',
            kind: 'info',
            okLabel: 'Export',
            cancelLabel: 'Cancel',
        });
        expect(downloadPdf).toHaveBeenCalledWith(pdf, input.filename);
    });

    it('does not write when confirm is cancelled', async () => {
        markTauri();
        confirm.mockResolvedValue(false);
        await expect(runExportHistoryPdf(input, labels)).resolves.toBe(false);
        expect(downloadPdf).not.toHaveBeenCalled();
    });

    it('still downloads when Tauri path/confirm throws', async () => {
        markTauri();
        downloadDir.mockRejectedValue(new Error('plugin:path not available'));
        await expect(runExportHistoryPdf(input, labels)).resolves.toBe(true);
        expect(downloadPdf).toHaveBeenCalledWith(pdf, input.filename);
    });
});
