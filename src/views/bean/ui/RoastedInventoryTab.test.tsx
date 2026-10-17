// @vitest-environment jsdom
import { roastedStockEventApi } from '@entities/roasted-stock-event/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RoastedInventoryTab } from './RoastedInventoryTab';

vi.mock('@entities/organization', () => ({ useActiveWorkspace: () => ({ workspaceOwnerId: 'owner' }) }));
vi.mock('@entities/bean/queries', () => ({ useBeans: () => ({ data: [{ id: 'quiet', name: 'Quiet lot' }] }) }));
vi.mock('@entities/blend', () => ({ useBlends: () => ({ data: [] }) }));
vi.mock('@features/adjust-stock', () => ({ AdjustStockModal: () => null }));
vi.mock('@entities/roasted-stock-event/api', () => ({
    ROASTED_HISTORY_LIMIT: 20,
    roastedStockEventApi: { getUserRoastedStock: vi.fn(), listByLot: vi.fn() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('loads history only on expansion, caps at 20 with an indicator, and preserves stock kg', async () => {
    vi.mocked(roastedStockEventApi.getUserRoastedStock).mockResolvedValue({
        'bean:quiet': { grams: 1500, hasEstimate: false },
    });
    vi.mocked(roastedStockEventApi.listByLot).mockResolvedValue(
        Array.from({ length: 21 }, (_, i) => ({
            id: `ev-${i}`,
            delta_grams: 100,
            event_type: 'roast_inbound',
            created_at: '2026-10-01T00:00:00Z',
        })) as Awaited<ReturnType<typeof roastedStockEventApi.listByLot>>,
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const host = document.createElement('div');
    const root = createRoot(host);
    const flush = () =>
        act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
        });
    try {
        act(() => root.render(createElement(QueryClientProvider, { client: qc }, createElement(RoastedInventoryTab))));
        await flush();
        expect(roastedStockEventApi.listByLot).not.toHaveBeenCalled();
        act(() => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Quiet lot')?.click());
        await flush();
        expect(roastedStockEventApi.listByLot).toHaveBeenCalledWith(
            'owner',
            expect.objectContaining({ kind: 'bean', id: 'quiet' }),
        );
        expect(host.querySelectorAll('li')).toHaveLength(20);
        expect(host.textContent).toContain('inventory.event.recentLimit');
        expect(host.textContent).toContain('1.50 kg');
    } finally {
        act(() => root.unmount());
        qc.clear();
    }
});
