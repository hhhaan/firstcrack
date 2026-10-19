import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orderDispatchApi } from './api';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@shared/lib/supabase', () => ({ supabase: { from: mocks.from } }));

describe('page-scoped order dispatch reads', () => {
    beforeEach(() => mocks.from.mockReset());

    it('restricts dispatches to the workspace and current page ids, preserving failed details', async () => {
        const failed = { order_id: 'order-2', status: 'failed', last_error: 'Carrier rejected tracking' };
        const inFilter = vi.fn().mockResolvedValue({ data: [failed], error: null });
        const eq = vi.fn().mockReturnValue({ in: inFilter });
        const select = vi.fn().mockReturnValue({ eq });
        mocks.from.mockReturnValue({ select });
        const ids = Array.from({ length: 20 }, (_, i) => `order-${i + 1}`);
        expect(await orderDispatchApi.listByOrders('workspace-owner', ids)).toEqual([failed]);
        expect(eq).toHaveBeenCalledWith('user_id', 'workspace-owner');
        expect(inFilter).toHaveBeenCalledWith('order_id', ids);
        expect(select.mock.calls[0]?.[0]).toContain('last_error');
    });

    it('does not read any dispatches for an empty page', async () => {
        expect(await orderDispatchApi.listByOrders('workspace-owner', [])).toEqual([]);
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('propagates read failures', async () => {
        mocks.from.mockReturnValue({
            select: () => ({ eq: () => ({ in: async () => ({ data: null, error: new Error('offline') }) }) }),
        });
        await expect(orderDispatchApi.listByOrders('owner', ['id'])).rejects.toThrow('offline');
    });
});
