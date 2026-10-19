// @vitest-environment jsdom

import type { OrderWithLines } from '@entities/order';
import { orderApi } from '@entities/order/api';
import { orderDispatchApi } from '@entities/order-dispatch/api';
import { orderKeys } from '@shared/lib/query-keys';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersTab } from './OrdersTab';

vi.mock('@entities/order/api', () => ({ orderApi: { listPaginated: vi.fn() } }));
vi.mock('@entities/order-dispatch/api', () => ({ orderDispatchApi: { listByOrders: vi.fn() } }));
vi.mock('@entities/organization', () => ({ useActiveWorkspace: () => ({ workspaceOwnerId: 'owner' }) }));
vi.mock('@features/order-status', () => ({
    useCancelOrder: () => ({ mutate: vi.fn() }),
    useFulfillOrder: () => ({ mutate: vi.fn() }),
    orderActionFlags: () => ({ cancelled: false, fulfilled: false, canFulfill: false, canDispatch: false }),
}));
vi.mock('@features/dispatch-order', () => ({ DispatchModal: () => null }));
vi.mock('@features/map-channel-product', () => ({ LinkOrderLineModal: () => null }));
vi.mock('@widgets/add-order-modal', () => ({ AddOrderModal: () => null }));
vi.mock('@widgets/roasting-requirements-card', () => ({ RoastingRequirementsCard: () => null }));
vi.mock('@widgets/date-range-filter', () => ({ DateRangeFilter: () => null, getPresetYMRange: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const order = (id: string) =>
    ({
        id,
        buyer_name: `Buyer ${id}`,
        platform: 'manual',
        status: 'paid',
        ordered_at: '2026-10-01T00:00:00Z',
        order_lines: [],
    }) as unknown as OrderWithLines;

describe('OrdersTab count and dispatch freshness', () => {
    let host: HTMLDivElement;
    let root: Root;
    let qc: QueryClient;
    let total: number;
    const flush = () =>
        act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
        });
    beforeEach(() => {
        total = 41;
        vi.mocked(orderApi.listPaginated)
            .mockReset()
            .mockImplementation(async ({ page, pageSize }) => ({
                total,
                data: (page - 1) * pageSize < total ? [order(String(page))] : [],
            }));
        vi.mocked(orderDispatchApi.listByOrders).mockReset().mockResolvedValue([]);
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        qc.clear();
        vi.useRealTimers();
    });
    const render = () =>
        act(() => root.render(createElement(QueryClientProvider, { client: qc }, createElement(OrdersTab))));
    const pageButton = (page: number) =>
        [...host.querySelectorAll('button')].find((button) => button.textContent === String(page)) as HTMLButtonElement;

    it('requests page 1 and displays remaining rows when page 3 shrinks below 21 orders', async () => {
        render();
        await flush();
        act(() => pageButton(3).click());
        await flush();
        expect(host.textContent).toContain('Buyer 3');
        total = 15;
        await act(async () => {
            await qc.invalidateQueries({ queryKey: orderKeys.all('owner') });
        });
        await flush();
        await flush();
        expect(host.textContent).toContain('Buyer 1');
        expect(orderApi.listPaginated).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
        expect(pageButton(1).className).toContain('bg-surface-warm-solid');
        expect(orderDispatchApi.listByOrders).toHaveBeenCalledWith('owner', ['1']);
        expect(orderDispatchApi.listByOrders).toHaveBeenCalledWith('owner', ['3']);
    });

    it('returns to page 1 even when the count drops to zero', async () => {
        render();
        await flush();
        act(() => pageButton(3).click());
        await flush();
        total = 0;
        await act(async () => {
            await qc.invalidateQueries({ queryKey: orderKeys.all('owner') });
        });
        await flush();
        await flush();
        total = 5;
        await act(async () => {
            await qc.invalidateQueries({ queryKey: orderKeys.all('owner') });
        });
        await flush();
        await flush();
        expect(host.textContent).toContain('Buyer 1');
    });

    it('does not clamp from a placeholder count before the requested count arrives', async () => {
        total = 100;
        render();
        await flush();
        let resolvePage!: (value: { data: OrderWithLines[]; total: number }) => void;
        vi.mocked(orderApi.listPaginated).mockImplementation(({ page }) =>
            page === 5
                ? new Promise((resolve) => {
                      resolvePage = resolve;
                  })
                : Promise.resolve({ data: [order(String(page))], total }),
        );
        act(() => pageButton(5).click());
        await flush();
        expect(orderApi.listPaginated).toHaveBeenLastCalledWith(expect.objectContaining({ page: 5 }));
        await act(async () => resolvePage({ data: [order('5')], total: 100 }));
        await flush();
        expect(host.textContent).toContain('Buyer 5');
    });

    it('updates the sent badge after two minutes without remounting', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-01T01:00:00Z'));
        total = 1;
        vi.mocked(orderDispatchApi.listByOrders).mockResolvedValue([
            { order_id: '1', status: 'sent', sent_at: '2026-10-01T00:31:00Z' },
        ] as Awaited<ReturnType<typeof orderDispatchApi.listByOrders>>);
        render();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(20);
        });
        expect(host.textContent).toContain('orders.dispatch.status.sent');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(120_000);
        });
        expect(host.textContent).toContain('orders.dispatch.delayed');
    });
});
