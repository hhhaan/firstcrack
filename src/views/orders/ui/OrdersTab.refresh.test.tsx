// @vitest-environment jsdom

import { orderKeys } from '@entities/order';
import { orderDispatchKeys } from '@entities/order-dispatch';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrdersTab } from './OrdersTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { invalidateQueries } = vi.hoisted(() => ({
    invalidateQueries: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'user-1', isWorkspaceReady: true }),
}));
vi.mock('@entities/order', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@entities/order')>();
    return {
        ...actual,
        useOrdersPaginated: () => ({ data: { data: [], total: 0 }, isLoading: false }),
    };
});
vi.mock('@entities/order-dispatch', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@entities/order-dispatch')>();
    return {
        ...actual,
        useOrderDispatches: () => ({ data: [] }),
    };
});
vi.mock('@features/order-status', () => ({
    orderActionFlags: () => ({ cancelled: false, fulfilled: false, canFulfill: false, canDispatch: false }),
    useCancelOrder: () => ({ mutate: vi.fn(), isPending: false }),
    useFulfillOrder: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@features/dispatch-order', () => ({ DispatchModal: () => null }));
vi.mock('@features/map-channel-product', () => ({ LinkOrderLineModal: () => null }));
vi.mock('@widgets/add-order-modal', () => ({ AddOrderModal: () => null }));
vi.mock('@widgets/roasting-requirements-card', () => ({ RoastingRequirementsCard: () => null }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn() }));

describe('OrdersTab refresh', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        invalidateQueries.mockClear();
    });

    it('reloads the order list, roast demand, and dispatch badges', async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(createElement(OrdersTab));
        });

        const button = [...host.querySelectorAll('button')].find((el) =>
            el.textContent?.includes('orders.order.refresh'),
        );
        expect(button).toBeTruthy();

        await act(async () => {
            button?.click();
        });

        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: orderKeys.all('user-1') });
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: orderKeys.requirements('user-1') });
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: orderDispatchKeys.all('user-1') });
    });
});
