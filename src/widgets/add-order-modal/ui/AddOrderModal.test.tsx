// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddOrderModal } from './AddOrderModal';

const state = vi.hoisted(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
    onClose: vi.fn(),
    productId: 'product-1',
}));

vi.mock('@entities/order', () => ({
    useCreateOrder: () => ({ mutateAsync: state.mutateAsync, isPending: state.isPending }),
}));
vi.mock('@entities/product', () => ({
    useProducts: () => ({ data: [{ id: state.productId, name: 'House Blend' }] }),
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner-1' }),
}));
vi.mock('@shared/lib/useFormEscape', () => ({ useFormEscape: vi.fn() }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AddOrderModal', () => {
    let qc: QueryClient;
    let root: ReturnType<typeof createRoot>;
    let container: HTMLDivElement;

    beforeEach(() => {
        state.isPending = false;
        state.onClose = vi.fn();
        state.mutateAsync = vi.fn();
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        for (const el of document.body.querySelectorAll('[role="dialog"]')) el.remove();
    });

    const render = async (open = true) => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={qc}>
                    <AddOrderModal open={open} onClose={state.onClose} />
                </QueryClientProvider>,
            );
        });
    };

    const modalRoot = () => document.body;

    const selectProduct = async () => {
        const select = modalRoot().querySelector('select') as HTMLSelectElement;
        await act(async () => {
            select.value = state.productId;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
    };

    const clickSubmit = async () => {
        const btn = modalRoot().querySelector('[data-testid="add-order-submit"]') as HTMLButtonElement;
        await act(async () => {
            btn.click();
        });
    };

    it('calls create once when submit is clicked twice during a pending mutation', async () => {
        let resolve!: (value: string) => void;
        state.mutateAsync.mockImplementation(
            () =>
                new Promise<string>((r) => {
                    resolve = r;
                }),
        );

        await render();
        await selectProduct();
        await clickSubmit();
        await clickSubmit();

        expect(state.mutateAsync).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolve('order-id');
            await Promise.resolve();
        });
    });

    it('shows error and retries with the same platform_order_id until success', async () => {
        state.mutateAsync.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('order-id');

        await render();
        await selectProduct();
        await clickSubmit();

        await act(async () => {
            await Promise.resolve();
        });

        expect(modalRoot().textContent).toContain('orders.order.createFailed');
        expect(state.onClose).not.toHaveBeenCalled();

        const firstKey = state.mutateAsync.mock.calls[0][0].order.platform_order_id;

        await clickSubmit();

        await act(async () => {
            await Promise.resolve();
        });

        expect(state.mutateAsync).toHaveBeenCalledTimes(2);
        expect(state.mutateAsync.mock.calls[1][0].order.platform_order_id).toBe(firstKey);
        expect(state.onClose).toHaveBeenCalledTimes(1);
    });

    it('sends manual paid order payload', async () => {
        state.mutateAsync.mockResolvedValue('order-id');

        await render();
        await selectProduct();
        await clickSubmit();

        await act(async () => {
            await Promise.resolve();
        });

        const payload = state.mutateAsync.mock.calls[0][0];
        expect(payload.order.platform).toBe('manual');
        expect(payload.order.status).toBe('paid');
        expect(payload.order.user_id).toBe('owner-1');
        expect(payload.order.platform_order_id).toMatch(/^manual-/);
        expect(payload.lines).toHaveLength(1);
        expect(payload.lines[0].product_id).toBe(state.productId);
    });
});
