// @vitest-environment jsdom

import { roastSessionApi } from '@entities/roast/api';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CuppingAddSamplesForm } from './CuppingAddSamplesForm';

const mocks = vi.hoisted(() => ({ add: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@entities/roast/api', () => ({ roastSessionApi: { listPaginated: vi.fn() } }));
vi.mock('@entities/cupping', () => ({
    useAddCuppingSamples: () => ({ mutateAsync: mocks.add }),
    useUpdateCuppingSample: () => ({ mutateAsync: vi.fn() }),
    formatBeanCuppingMeta: () => '',
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('loads completed roasts in pages and saves the selected older roast id and bean label', async () => {
    vi.mocked(roastSessionApi.listPaginated).mockImplementation(async ({ page = 1 }) => ({
        total: 11,
        data: [
            {
                id: `session-${page}`,
                roasted_at: '2026-10-01T00:00:00Z',
                beans: { name: `Bean ${page}` },
            } as RoastSessionWithRelations,
        ],
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const flush = () =>
        act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
        });
    try {
        act(() =>
            root.render(
                createElement(
                    QueryClientProvider,
                    { client: qc },
                    createElement(CuppingAddSamplesForm, { userId: 'owner', eventId: 'event', onClose: vi.fn() }),
                ),
            ),
        );
        await flush();
        expect(roastSessionApi.listPaginated).toHaveBeenCalledWith(
            expect.objectContaining({ page: 1, pageSize: 10, status: 'completed' }),
        );
        act(() =>
            [...document.querySelectorAll('button')]
                .find((button) => button.textContent === 'cupping.loadMoreRoasts')
                ?.click(),
        );
        await flush();
        expect(roastSessionApi.listPaginated).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
        const labels = [...document.querySelectorAll('label')];
        act(() =>
            labels
                .find((label) => label.textContent?.includes('Bean 2'))
                ?.querySelector('input')
                ?.click(),
        );
        await act(async () =>
            [...document.querySelectorAll('button')].find((button) => button.textContent === 'cupping.add')?.click(),
        );
        expect(mocks.add).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ label: 'Bean 2', roastSessionId: 'session-2' })]),
        );
    } finally {
        act(() => root.unmount());
        host.remove();
        qc.clear();
    }
});
