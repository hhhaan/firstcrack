// @vitest-environment jsdom
import en from '@shared/i18n/locales/en.json';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useHistoryPdfExport } from './useHistoryPdfExport';

const mocks = vi.hoisted(() => ({ exportPdf: vi.fn(async () => true) }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) =>
            key
                .split('.')
                .reduce<unknown>(
                    (value, part) =>
                        value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
                    en,
                ) ?? key,
    }),
}));
vi.mock('@features/active-roast', () => ({
    formatTemp: (value: unknown) => String(value),
    useRoastSettings: () => ({ totalBatchPrefix: 'PR' }),
}));
vi.mock('@features/export-history-pdf', async () => ({
    historyPdfFilename: (await import('@features/export-history-pdf/lib/filename')).historyPdfFilename,
    historyPdfChartBox: () => ({ width: 100, height: 100 }),
    useExportHistoryPdf: () => mocks.exportPdf,
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('exports the selected batch title in the filename and PDF header while retaining the actual bean', async () => {
    const getDataURL = vi.fn(() => 'data:image/png;base64,AA==');
    const chartRef = { current: { getDataURL } } as unknown as Parameters<typeof useHistoryPdfExport>[0]['chartRef'];
    const session = {
        batch_name: 'Batch A',
        profile_batch_number: 9,
        total_batch_number: 13,
        beans: { name: 'Green B' },
        roasted_at: '2026-10-19T14:35:47',
    } as unknown as RoastSessionWithRelations;
    let latest!: ReturnType<typeof useHistoryPdfExport>;
    const Probe = ({ value }: { value: RoastSessionWithRelations }) => {
        latest = useHistoryPdfExport({ session: value, chartRef, hasControls: false, unit: 'C', canCapture: true });
        return null;
    };
    const root = createRoot(document.createElement('div'));
    try {
        await act(async () => root.render(createElement(Probe, { value: session })));
        await act(async () => latest.onExportPdf());
        expect(getDataURL).toHaveBeenCalledWith({ width: 100, height: 100, pixelRatio: 200 / 72 });
        expect(mocks.exportPdf).toHaveBeenLastCalledWith(
            expect.objectContaining({
                filename: expect.stringContaining('batch-a'),
                header: expect.objectContaining({
                    roastTitle: 'Batch A',
                    bean: 'Green B',
                    batchNumbers: '#9 · PR13',
                    date: '26-10-19 14:35',
                    labels: expect.objectContaining({ roastTitle: en.history.recordText.title }),
                }),
            }),
        );
        await act(async () => root.render(createElement(Probe, { value: { ...session, batch_name: 'Batch B' } })));
        await act(async () => latest.onExportPdf());
        expect(mocks.exportPdf).toHaveBeenLastCalledWith(
            expect.objectContaining({
                filename: expect.stringContaining('batch-b'),
                header: expect.objectContaining({
                    roastTitle: 'Batch B',
                    bean: 'Green B',
                    batchNumbers: '#9 · PR13',
                }),
            }),
        );
        await act(async () =>
            root.render(createElement(Probe, { value: { ...session, batch_name: null, bean_label: null } })),
        );
        await act(async () => latest.onExportPdf());
        expect(mocks.exportPdf).toHaveBeenLastCalledWith(
            expect.objectContaining({
                filename: expect.stringContaining('green-b'),
                header: expect.objectContaining({
                    bean: 'Green B',
                    labels: expect.not.objectContaining({ roastTitle: expect.anything() }),
                }),
            }),
        );
        expect(mocks.exportPdf).toHaveBeenLastCalledWith(
            expect.objectContaining({
                header: expect.not.objectContaining({ roastTitle: expect.anything() }),
            }),
        );
        for (const value of [
            { ...session, batch_name: null, bean_label: 'Green B', beans: null },
            { ...session, batch_name: null, bean_label: 'Green B' },
        ]) {
            await act(async () => root.render(createElement(Probe, { value })));
            await act(async () => latest.onExportPdf());
            expect(mocks.exportPdf).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    header: expect.not.objectContaining({ roastTitle: expect.anything() }),
                }),
            );
        }
        await act(async () => root.render(createElement(Probe, { value: { ...session, batch_name: 'Green B' } })));
        await act(async () => latest.onExportPdf());
        expect(mocks.exportPdf).toHaveBeenLastCalledWith(
            expect.objectContaining({
                header: expect.not.objectContaining({ roastTitle: expect.anything() }),
            }),
        );
    } finally {
        act(() => root.unmount());
    }
});

it('disables PDF export while a roast is in progress', async () => {
    mocks.exportPdf.mockClear();
    const getDataURL = vi.fn(() => 'data:image/png;base64,AA==');
    const chartRef = { current: { getDataURL } } as unknown as Parameters<typeof useHistoryPdfExport>[0]['chartRef'];
    const session = { roasted_at: '2026-10-19T14:35:47' } as unknown as RoastSessionWithRelations;
    let latest!: ReturnType<typeof useHistoryPdfExport>;
    const Probe = ({ roasting }: { roasting: boolean }) => {
        latest = useHistoryPdfExport({
            session,
            chartRef,
            hasControls: false,
            unit: 'C',
            canCapture: true,
            roasting,
        });
        return null;
    };
    const root = createRoot(document.createElement('div'));
    try {
        await act(async () => root.render(createElement(Probe, { roasting: true })));
        expect(latest.canExport).toBe(false);
        await act(async () => latest.onExportPdf());
        expect(getDataURL).not.toHaveBeenCalled();
        expect(mocks.exportPdf).not.toHaveBeenCalled();
        await act(async () => root.render(createElement(Probe, { roasting: false })));
        expect(latest.canExport).toBe(true);
    } finally {
        act(() => root.unmount());
    }
});
