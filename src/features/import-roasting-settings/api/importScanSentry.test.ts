// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { observe } = vi.hoisted(() => ({ observe: vi.fn() }));
vi.mock('@shared/lib/sentry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/sentry')>();
    return { ...actual, observeRoastingImportScan: observe };
});

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { useArtisanSettings } from './useArtisanSettings';
import { useCropsterSettings } from './useCropsterSettings';
import { useFirescopeSettings } from './useFirescopeSettings';

describe('import scan observeRoastingImportScan hook wiring', () => {
    let root: Root;
    let qc: QueryClient;

    beforeEach(() => {
        observe.mockClear();
        vi.mocked(invoke).mockReset();
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    });

    afterEach(() => {
        act(() => root?.unmount());
    });

    const runProbe = async (Probe: () => null) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
        });
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    };

    it('observes Firescope unreadable scans', async () => {
        vi.mocked(invoke).mockResolvedValue({
            status: 'unreadable',
            reason: 'database-unreadable',
            source: { product: 'Firescope', version: '1.0' },
            graphTemperatureUnit: null,
            graph: null,
            indicator: null,
            global: null,
            machines: [],
        });
        const FirescopeProbe = () => {
            useFirescopeSettings(true);
            return null;
        };
        await runProbe(FirescopeProbe);
        expect(observe).toHaveBeenCalledWith({
            status: 'unreadable',
            reason: 'database-unreadable',
            source: { product: 'Firescope', version: '1.0' },
        });
    });

    it('observes Artisan unsupported scans', async () => {
        vi.mocked(invoke).mockResolvedValue({
            status: 'unsupported',
            reason: 'settings-files',
            source: { product: 'Artisan', version: null, sourceId: 'native' },
            settings: null,
        });
        const ArtisanProbe = () => {
            useArtisanSettings(true);
            return null;
        };
        await runProbe(ArtisanProbe);
        expect(observe).toHaveBeenCalledWith({
            status: 'unsupported',
            reason: 'settings-files',
            source: { product: 'Artisan', version: null },
        });
    });

    it('observes Cropster unreadable scans', async () => {
        vi.mocked(invoke).mockResolvedValue({
            status: 'unreadable',
            reason: 'settings-unreadable',
            source: { product: 'Cropster', version: '3', sourceId: 'default' },
            machine: null,
            preferences: null,
        });
        const CropsterProbe = () => {
            useCropsterSettings(true);
            return null;
        };
        await runProbe(CropsterProbe);
        expect(observe).toHaveBeenCalledWith({
            status: 'unreadable',
            reason: 'settings-unreadable',
            source: { product: 'Cropster', version: '3' },
        });
    });
});
