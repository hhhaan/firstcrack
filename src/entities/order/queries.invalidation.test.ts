import { orderKeys } from '@shared/lib/query-keys';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateAfterCreateOrder } from './queries';

describe('order mutation invalidation', () => {
    it('create invalidates orders list and roasting requirements', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const spy = vi.spyOn(qc, 'invalidateQueries');

        invalidateAfterCreateOrder(qc, 'user-1');

        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey);
        expect(keys).toContainEqual(orderKeys.all('user-1'));
        expect(keys).toContainEqual(orderKeys.requirements('user-1'));
        expect(spy).toHaveBeenCalledTimes(2);
    });
});
