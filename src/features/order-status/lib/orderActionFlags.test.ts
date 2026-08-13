import { describe, expect, it } from 'vitest';
import { orderActionFlags } from './orderActionFlags';

const base = {
    status: 'paid',
    fulfilled_at: null as string | null,
    platform: 'naver',
    connection_id: 'c1',
};

describe('orderActionFlags', () => {
    it('lets shipped/delivered without fulfilled_at fulfill, but not dispatch', () => {
        for (const status of ['shipped', 'delivered', 'confirmed'] as const) {
            const flags = orderActionFlags({ ...base, status });
            expect(flags.canFulfill).toBe(true);
            expect(flags.canDispatch).toBe(false);
            expect(flags.fulfilled).toBe(false);
        }
    });

    it('blocks dispatch until fulfilled_at is set', () => {
        const before = orderActionFlags({ ...base, status: 'shipped' });
        expect(before.canDispatch).toBe(false);
        const after = orderActionFlags({ ...base, status: 'shipped', fulfilled_at: '2026-08-01T00:00:00Z' });
        expect(after.canFulfill).toBe(false);
        expect(after.canDispatch).toBe(true);
    });

    it('keeps paid/preparing fulfillable', () => {
        expect(orderActionFlags({ ...base, status: 'paid' }).canFulfill).toBe(true);
        expect(orderActionFlags({ ...base, status: 'preparing' }).canFulfill).toBe(true);
    });

    it('never fulfills or dispatches cancelled/refunded', () => {
        for (const status of ['cancelled', 'refunded'] as const) {
            const flags = orderActionFlags({
                ...base,
                status,
                fulfilled_at: '2026-08-01T00:00:00Z',
            });
            expect(flags.canFulfill).toBe(false);
            expect(flags.canDispatch).toBe(false);
        }
    });
});
