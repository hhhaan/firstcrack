import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    rpc: vi.fn(),
    from: vi.fn(),
}));

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        rpc: (...args: unknown[]) => mocks.rpc(...args),
        from: (...args: unknown[]) => mocks.from(...args),
    },
}));

import type { OrderInsert } from './api';
import { orderApi } from './api';

const order = {
    user_id: 'user-1',
    platform: 'manual',
    platform_order_id: 'manual-1',
    status: 'paid',
    ordered_at: '2026-09-28T00:00:00.000Z',
} as OrderInsert;

const lines = [{ platform_line_id: 'line-0', product_id: 'prod-1', title: 'Bag', quantity: 1 }];

function selectSingle(result: { data: unknown; error: unknown }) {
    const q = {
        select: vi.fn(),
        eq: vi.fn(),
        single: vi.fn(async () => result),
    };
    q.select.mockReturnValue(q);
    q.eq.mockReturnValue(q);
    return q;
}

describe('orderApi.create', () => {
    beforeEach(() => {
        mocks.rpc.mockReset();
        mocks.from.mockReset();
    });

    it('does not treat a follow-up read failure as a failed save', async () => {
        const readError = { message: 'network down' };
        const chain = selectSingle({ data: null, error: readError });
        mocks.rpc.mockResolvedValue({ data: 'order-1', error: null });
        mocks.from.mockReturnValue(chain);

        await expect(orderApi.create(order, lines)).resolves.toEqual({
            refetchFailed: true,
            orderId: 'order-1',
        });
        expect(chain.eq).toHaveBeenCalledWith('id', 'order-1');
    });

    it('returns the order when the follow-up read succeeds', async () => {
        const saved = { id: 'order-1', order_lines: [] };
        mocks.rpc.mockResolvedValue({ data: 'order-1', error: null });
        mocks.from.mockReturnValue(selectSingle({ data: saved, error: null }));

        await expect(orderApi.create(order, lines)).resolves.toEqual({
            refetchFailed: false,
            order: saved,
        });
    });

    it('still fails when create_order itself fails', async () => {
        const rpcError = { message: 'order_lines_required' };
        mocks.rpc.mockResolvedValue({ data: null, error: rpcError });

        await expect(orderApi.create(order, lines)).rejects.toEqual(rpcError);
        expect(mocks.from).not.toHaveBeenCalled();
    });
});
