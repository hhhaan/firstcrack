// @vitest-environment jsdom
import { orderKeys } from '@shared/lib/query-keys';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderInsert } from './api';
import { orderApi } from './api';
import { useCreateOrder } from './queries';

vi.mock('./api', () => ({
    orderApi: { create: vi.fn() },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const order = { user_id: 'user-1' } as OrderInsert;
const lines = [{ platform_line_id: 'line-0', title: 'Bag', quantity: 1 }];

describe('useCreateOrder after a committed save', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let qc: QueryClient;
    let mutate: () => Promise<unknown> = async () => {
        throw new Error('mutate was not mounted');
    };

    beforeEach(() => {
        vi.mocked(orderApi.create).mockReset();
        qc = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        const Probe = () => {
            const create = useCreateOrder('user-1');
            mutate = () => create.mutateAsync({ order, lines });
            return null;
        };
        act(() => {
            root.render(
                <QueryClientProvider client={qc}>
                    <Probe />
                </QueryClientProvider>,
            );
        });
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it('invalidates the list when the save committed and the follow-up read failed', async () => {
        vi.mocked(orderApi.create).mockResolvedValue({ refetchFailed: true, orderId: 'order-1' });
        const spy = vi.spyOn(qc, 'invalidateQueries');

        await act(async () => {
            await mutate();
        });

        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey);
        expect(keys).toContainEqual(orderKeys.all('user-1'));
        expect(keys).toContainEqual(orderKeys.requirements('user-1'));
    });

    it('does not invalidate when create_order fails', async () => {
        vi.mocked(orderApi.create).mockRejectedValue(new Error('order_lines_required'));
        const spy = vi.spyOn(qc, 'invalidateQueries');

        await act(async () => {
            await mutate().catch(() => undefined);
        });

        expect(spy).not.toHaveBeenCalled();
    });
});
