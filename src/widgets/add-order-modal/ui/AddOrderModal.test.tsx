// @vitest-environment jsdom
import { useToastStore } from '@shared/store/toast';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddOrderModal } from './AddOrderModal';

const mocks = vi.hoisted(() => ({
    mutateAsync: vi.fn(),
}));

vi.mock('@entities/order', () => ({
    useCreateOrder: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner-1' }),
}));
vi.mock('@entities/product', () => ({
    useProducts: () => ({ data: [{ id: 'prod-1', name: 'Kenya 200g' }] }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Harness = () => {
    const [open, setOpen] = useState(true);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                reopen
            </button>
            <AddOrderModal open={open} onClose={() => setOpen(false)} />
        </>
    );
};

const submittedOrder = (call: number) => {
    const arg = mocks.mutateAsync.mock.calls[call]?.[0] as
        | { order: { platform_order_id: string; ordered_at: string } }
        | undefined;
    if (!arg) throw new Error(`missing submit call ${call}`);
    return arg.order;
};

describe('AddOrderModal submission key', () => {
    let host: HTMLDivElement;
    let root: Root;

    const button = (label: string) => {
        const el = [...host.querySelectorAll('button')].find((node) => node.textContent === label);
        if (!el) throw new Error(`missing button ${label}`);
        return el as HTMLButtonElement;
    };

    const chooseProduct = () => {
        const select = host.querySelector('select');
        if (!select) throw new Error('missing product select');
        act(() => {
            select.value = 'prod-1';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
    };

    beforeEach(() => {
        mocks.mutateAsync.mockReset();
        for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
    });

    const mount = async () => {
        await act(async () => {
            root.render(<Harness />);
        });
        chooseProduct();
    };

    it('reuses the same key when the response is lost and the form is submitted again', async () => {
        mocks.mutateAsync.mockRejectedValueOnce(new Error('Failed to fetch'));
        await mount();

        await act(async () => {
            button('common.add').click();
        });
        const first = submittedOrder(0);

        mocks.mutateAsync.mockResolvedValueOnce({ refetchFailed: false, order: { id: 'order-1' } });
        await act(async () => {
            button('common.add').click();
        });
        const second = submittedOrder(1);

        expect(second.platform_order_id).toBe(first.platform_order_id);
        expect(second.ordered_at).toBe(first.ordered_at);
        expect(first.platform_order_id).toMatch(/^manual-/);
    });

    it('ignores a second click while the first submit is in flight', async () => {
        let release: (value: unknown) => void = () => {};
        mocks.mutateAsync.mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                }),
        );
        await mount();

        await act(async () => {
            const add = button('common.add');
            add.click();
            add.click();
        });

        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
        await act(async () => {
            release({ refetchFailed: false, order: { id: 'order-1' } });
        });
    });

    it('closes with a non-blocking notice when the save committed but the follow-up read failed', async () => {
        mocks.mutateAsync.mockResolvedValue({ refetchFailed: true, orderId: 'order-1' });
        await mount();

        await act(async () => {
            button('common.add').click();
        });

        expect(host.querySelector('[role="dialog"]')).toBeNull();
        expect(useToastStore.getState().toasts).toEqual([
            expect.objectContaining({ message: 'orders.order.savedUnread', tone: 'info' }),
        ]);
    });

    it('mints a new key after the saved form is closed and opened again', async () => {
        mocks.mutateAsync.mockResolvedValue({ refetchFailed: false, order: { id: 'order-1' } });
        await mount();
        await act(async () => {
            button('common.add').click();
        });
        const first = submittedOrder(0).platform_order_id;
        expect(useToastStore.getState().toasts).toHaveLength(0);

        await act(async () => {
            button('reopen').click();
        });
        chooseProduct();
        await act(async () => {
            button('common.add').click();
        });

        expect(submittedOrder(1).platform_order_id).not.toBe(first);
    });
});
