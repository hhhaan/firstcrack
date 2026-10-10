import { describe, expect, it } from 'vitest';

type Line = { productId: string | null; quantity: number; prev: string; next: string };
type Context = { fulfilledAt: string | null; prevStatus: string; nextStatus: string; autoFulfill: boolean };

// Frozen pre-RPC behavior used as parity fixtures for channel_orders_batch.sql.
const reference = (ctx: Context, lines: Line[]) => {
    const events: Array<{ type: string; quantity: number }> = [];
    for (const line of lines) {
        if (
            line.productId &&
            line.prev === 'active' &&
            ['cancelled', 'refunded'].includes(line.next) &&
            ctx.fulfilledAt
        ) {
            events.push({ type: 'order_cancel', quantity: line.quantity });
        }
    }
    const becameShipped =
        ['shipped', 'delivered'].includes(ctx.nextStatus) && !['shipped', 'delivered'].includes(ctx.prevStatus);
    if (becameShipped && ctx.autoFulfill && !ctx.fulfilledAt) {
        for (const line of lines) {
            if (line.productId && line.next === 'active') {
                events.push({ type: 'order_fulfillment', quantity: -line.quantity });
            }
        }
    }
    return events;
};

describe('inbound action SQL parity fixtures', () => {
    const active = { productId: 'product', quantity: 2, prev: 'active', next: 'active' };

    it('fulfills mapped active lines only on the first shipped transition', () => {
        expect(
            reference({ fulfilledAt: null, prevStatus: 'paid', nextStatus: 'shipped', autoFulfill: true }, [active]),
        ).toEqual([{ type: 'order_fulfillment', quantity: -2 }]);
        expect(
            reference({ fulfilledAt: null, prevStatus: 'shipped', nextStatus: 'delivered', autoFulfill: true }, [
                active,
            ]),
        ).toEqual([]);
        expect(
            reference({ fulfilledAt: null, prevStatus: 'paid', nextStatus: 'shipped', autoFulfill: false }, [active]),
        ).toEqual([]);
    });

    it('restores only fulfilled mapped lines that newly become terminal', () => {
        expect(
            reference(
                { fulfilledAt: '2026-01-01', prevStatus: 'shipped', nextStatus: 'cancelled', autoFulfill: true },
                [
                    { ...active, next: 'cancelled' },
                    { ...active, productId: null, next: 'cancelled' },
                    { ...active, prev: 'cancelled', next: 'cancelled' },
                ],
            ),
        ).toEqual([{ type: 'order_cancel', quantity: 2 }]);
        expect(
            reference({ fulfilledAt: null, prevStatus: 'paid', nextStatus: 'cancelled', autoFulfill: true }, [
                { ...active, next: 'cancelled' },
            ]),
        ).toEqual([]);
    });

    it('treats refunds like cancellation', () => {
        expect(
            reference({ fulfilledAt: '2026-01-01', prevStatus: 'shipped', nextStatus: 'refunded', autoFulfill: true }, [
                { ...active, next: 'refunded', quantity: 1 },
            ]),
        ).toEqual([{ type: 'order_cancel', quantity: 1 }]);
    });

    it('does not restore an unmapped fulfilled line', () => {
        expect(
            reference(
                { fulfilledAt: '2026-01-01', prevStatus: 'shipped', nextStatus: 'cancelled', autoFulfill: true },
                [{ ...active, productId: null, next: 'cancelled' }],
            ),
        ).toEqual([]);
    });

    it('does not fulfill an already fulfilled order', () => {
        expect(
            reference({ fulfilledAt: '2026-01-01', prevStatus: 'paid', nextStatus: 'shipped', autoFulfill: true }, [
                active,
            ]),
        ).toEqual([]);
    });

    it('does not fulfill a shipped re-poll', () => {
        expect(
            reference({ fulfilledAt: null, prevStatus: 'shipped', nextStatus: 'shipped', autoFulfill: true }, [active]),
        ).toEqual([]);
    });

    it('fulfills active lines while excluding pre-fulfill cancellations', () => {
        expect(
            reference({ fulfilledAt: null, prevStatus: 'paid', nextStatus: 'shipped', autoFulfill: true }, [
                active,
                { ...active, productId: 'other', quantity: 1, next: 'cancelled' },
            ]),
        ).toEqual([{ type: 'order_fulfillment', quantity: -2 }]);
    });
});
