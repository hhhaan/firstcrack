import { orderKeys, productStockKeys } from '@shared/lib/query-keys';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateAfterSyncOrders, salesChannelKeys } from './queries';

describe('sales channel sync orders invalidation', () => {
    it('invalidates orders list, roasting requirements, sales channels, and product stock', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const spy = vi.spyOn(qc, 'invalidateQueries');

        invalidateAfterSyncOrders(qc, 'user-1');

        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey);
        expect(keys).toContainEqual(orderKeys.all('user-1'));
        expect(keys).toContainEqual(orderKeys.requirements('user-1'));
        expect(keys).toContainEqual(salesChannelKeys.all('user-1'));
        expect(keys).toContainEqual(productStockKeys.byUser('user-1'));
        expect(spy).toHaveBeenCalledTimes(4);
    });
});
