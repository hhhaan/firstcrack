import { describe, expect, it } from 'vitest';
import { planInboundStockActions } from './inbound-actions.ts';

const baseCtx = {
    userId: 'u1',
    fulfilledAt: null as string | null,
    prevStatus: 'paid' as const,
    nextStatus: 'paid' as const,
    autoFulfillOnShipped: false,
};

describe('planInboundStockActions', () => {
    it('pre-fulfill cancel → no events', () => {
        const r = planInboundStockActions(
            { ...baseCtx, fulfilledAt: null },
            [{ lineId: 'l1', productId: 'p1', quantity: 2, prev: 'active', next: 'cancelled' }],
        );
        expect(r.events).toEqual([]);
        expect(r.setFulfilledAt).toBe(false);
    });

    it('post-fulfill cancel → +qty order_cancel', () => {
        const r = planInboundStockActions(
            { ...baseCtx, fulfilledAt: '2024-01-01T00:00:00Z' },
            [{ lineId: 'l1', productId: 'p1', quantity: 3, prev: 'active', next: 'cancelled' }],
        );
        expect(r.events).toEqual([
            {
                user_id: 'u1',
                product_id: 'p1',
                delta_units: 3,
                event_type: 'order_cancel',
                reference_id: 'l1',
            },
        ]);
    });

    it('post-fulfill refund same as cancel', () => {
        const r = planInboundStockActions(
            { ...baseCtx, fulfilledAt: '2024-01-01T00:00:00Z' },
            [{ lineId: 'l1', productId: 'p1', quantity: 1, prev: 'active', next: 'refunded' }],
        );
        expect(r.events[0]?.event_type).toBe('order_cancel');
        expect(r.events[0]?.delta_units).toBe(1);
    });

    it('post-fulfill cancel unmapped product → skip', () => {
        const r = planInboundStockActions(
            { ...baseCtx, fulfilledAt: '2024-01-01T00:00:00Z' },
            [{ lineId: 'l1', productId: null, quantity: 2, prev: 'active', next: 'cancelled' }],
        );
        expect(r.events).toEqual([]);
    });

    it('paid→shipped autoFulfill true → fulfill events + setFulfilledAt', () => {
        const r = planInboundStockActions(
            {
                ...baseCtx,
                prevStatus: 'paid',
                nextStatus: 'shipped',
                autoFulfillOnShipped: true,
                fulfilledAt: null,
            },
            [
                { lineId: 'l1', productId: 'p1', quantity: 2, prev: 'active', next: 'active' },
                { lineId: 'l2', productId: 'p2', quantity: 1, prev: 'active', next: 'active' },
            ],
        );
        expect(r.setFulfilledAt).toBe(true);
        expect(r.events).toHaveLength(2);
        expect(r.events.every((e) => e.event_type === 'order_fulfillment')).toBe(true);
        expect(r.events.map((e) => e.delta_units)).toEqual([-2, -1]);
    });

    it('paid→shipped autoFulfill false → nothing', () => {
        const r = planInboundStockActions(
            {
                ...baseCtx,
                prevStatus: 'paid',
                nextStatus: 'shipped',
                autoFulfillOnShipped: false,
            },
            [{ lineId: 'l1', productId: 'p1', quantity: 2, prev: 'active', next: 'active' }],
        );
        expect(r.events).toEqual([]);
        expect(r.setFulfilledAt).toBe(false);
    });

    it('paid→shipped autoFulfill true but already fulfilled → nothing', () => {
        const r = planInboundStockActions(
            {
                ...baseCtx,
                prevStatus: 'paid',
                nextStatus: 'shipped',
                autoFulfillOnShipped: true,
                fulfilledAt: '2024-01-01T00:00:00Z',
            },
            [{ lineId: 'l1', productId: 'p1', quantity: 2, prev: 'active', next: 'active' }],
        );
        expect(r.events).toEqual([]);
        expect(r.setFulfilledAt).toBe(false);
    });

    it('shipped→shipped re-poll, already fulfilled → nothing', () => {
        const r = planInboundStockActions(
            {
                ...baseCtx,
                prevStatus: 'shipped',
                nextStatus: 'shipped',
                autoFulfillOnShipped: true,
                fulfilledAt: '2024-01-01T00:00:00Z',
            },
            [{ lineId: 'l1', productId: 'p1', quantity: 2, prev: 'active', next: 'active' }],
        );
        expect(r.events).toEqual([]);
    });

    it('shipped transition + cancel on other line before fulfill → fulfill active only', () => {
        const r = planInboundStockActions(
            {
                ...baseCtx,
                prevStatus: 'paid',
                nextStatus: 'shipped',
                autoFulfillOnShipped: true,
                fulfilledAt: null,
            },
            [
                { lineId: 'l1', productId: 'p1', quantity: 2, prev: 'active', next: 'active' },
                { lineId: 'l2', productId: 'p2', quantity: 1, prev: 'active', next: 'cancelled' },
            ],
        );
        // cancel before fulfill → no order_cancel; only active line fulfilled
        expect(r.events).toEqual([
            {
                user_id: 'u1',
                product_id: 'p1',
                delta_units: -2,
                event_type: 'order_fulfillment',
                reference_id: 'l1',
            },
        ]);
        expect(r.setFulfilledAt).toBe(true);
    });

    it('pure: same input twice → same output', () => {
        const ctx = {
            ...baseCtx,
            prevStatus: 'paid' as const,
            nextStatus: 'shipped' as const,
            autoFulfillOnShipped: true,
        };
        const lines = [
            { lineId: 'l1', productId: 'p1', quantity: 1, prev: 'active' as const, next: 'active' as const },
        ];
        expect(planInboundStockActions(ctx, lines)).toEqual(planInboundStockActions(ctx, lines));
    });
});
