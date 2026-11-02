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
    useExportHistoryPdf: () => mocks.exportPdf,
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('exports the selected batch title and date without report metadata', async () => {
    const capturePdf = vi.fn(async () => ({
        chartDataUrl: 'data:image/png;base64,AA==',
        legend: [{ color: '#e53935', label: 'BT (°C)', lineType: 'solid' as const }],
    }));
    const chartRef = { current: { capturePdf } };
    const session = {
        batch_name: 'Batch A',
        profile_batch_number: 9,
        total_batch_number: 13,
        beans: { name: 'Green B' },
        roasted_at: '2026-10-19T14:35:47',
    } as unknown as RoastSessionWithRelations;
    let latest!: ReturnType<typeof useHistoryPdfExport>;
    const Probe = ({ value }: { value: RoastSessionWithRelations }) => {
        latest = useHistoryPdfExport({ session: value, chartRef, canCapture: true });
        return null;
    };
    const root = createRoot(document.createElement('div'));
    try {
        await act(async () => root.render(createElement(Probe, { value: session })));
        await act(async () => latest.onExportPdf());
        expect(capturePdf).toHaveBeenCalledWith();
        expect(mocks.exportPdf).toHaveBeenLastCalledWith(
            expect.objectContaining({
                filename: expect.stringContaining('batch-a'),
                title: 'Batch A',
                date: '26-10-19 14:35',
                chartDataUrl: 'data:image/png;base64,AA==',
                legend: [{ color: '#e53935', label: 'BT (°C)', lineType: 'solid' }],
            }),
        );
        await act(async () => root.render(createElement(Probe, { value: { ...session, batch_name: 'Batch B' } })));
        await act(async () => latest.onExportPdf());
        expect(mocks.exportPdf).toHaveBeenLastCalledWith(
            expect.objectContaining({
                filename: expect.stringContaining('batch-b'),
                title: 'Batch B',
            }),
        );
        await act(async () =>
            root.render(createElement(Probe, { value: { ...session, batch_name: null, bean_label: null } })),
        );
        await act(async () => latest.onExportPdf());
        expect(mocks.exportPdf).toHaveBeenLastCalledWith(
            expect.objectContaining({
                filename: expect.stringContaining('green-b'),
                title: 'Green B',
            }),
        );
        expect(mocks.exportPdf).toHaveBeenLastCalledWith(
            expect.objectContaining({
                title: 'Green B',
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
                    title: 'Green B',
                }),
            );
        }
        await act(async () => root.render(createElement(Probe, { value: { ...session, batch_name: 'Green B' } })));
        await act(async () => latest.onExportPdf());
        expect(mocks.exportPdf).toHaveBeenLastCalledWith(
            expect.objectContaining({
                title: 'Green B',
            }),
        );
    } finally {
        act(() => root.unmount());
    }
});

it('disables PDF export while a roast is in progress', async () => {
    mocks.exportPdf.mockClear();
    const capturePdf = vi.fn(async () => ({
        chartDataUrl: 'data:image/png;base64,AA==',
        legend: [{ color: '#e53935', label: 'BT (°C)', lineType: 'solid' as const }],
    }));
    const chartRef = { current: { capturePdf } };
    const session = { roasted_at: '2026-10-19T14:35:47' } as unknown as RoastSessionWithRelations;
    let latest!: ReturnType<typeof useHistoryPdfExport>;
    const Probe = ({ roasting }: { roasting: boolean }) => {
        latest = useHistoryPdfExport({
            session,
            chartRef,
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
        expect(capturePdf).not.toHaveBeenCalled();
        expect(mocks.exportPdf).not.toHaveBeenCalled();
        await act(async () => root.render(createElement(Probe, { roasting: false })));
        expect(latest.canExport).toBe(true);
    } finally {
        act(() => root.unmount());
    }
});
