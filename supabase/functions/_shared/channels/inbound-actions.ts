/**
 * Pure planner for inbound stock side-effects during order upsert.
 * normalize.ts applies the result via insert_product_stock_events_batch.
 */

import type { CanonicalStatus } from './types.ts';

export interface InboundLineDiff {
    lineId: string;
    productId: string | null;
    quantity: number;
    prev: 'active' | 'cancelled' | 'refunded';
    next: 'active' | 'cancelled' | 'refunded';
}

export interface InboundContext {
    userId: string;
    fulfilledAt: string | null;
    prevStatus: CanonicalStatus;
    nextStatus: CanonicalStatus;
    autoFulfillOnShipped: boolean;
}

export interface StockEventDraft {
    user_id: string;
    product_id: string;
    delta_units: number;
    event_type: 'order_fulfillment' | 'order_cancel';
    reference_id: string;
}

export function planInboundStockActions(
    ctx: InboundContext,
    lines: InboundLineDiff[],
): { events: StockEventDraft[]; setFulfilledAt: boolean } {
    const events: StockEventDraft[] = [];

    for (const line of lines) {
        if (!line.productId) continue;
        const becameTerminal =
            line.prev === 'active' && (line.next === 'cancelled' || line.next === 'refunded');
        if (becameTerminal && ctx.fulfilledAt) {
            events.push({
                user_id: ctx.userId,
                product_id: line.productId,
                delta_units: line.quantity,
                event_type: 'order_cancel',
                reference_id: line.lineId,
            });
        }
    }

    const becameShipped =
        ctx.nextStatus === 'shipped' || ctx.nextStatus === 'delivered'
            ? ctx.prevStatus !== 'shipped' && ctx.prevStatus !== 'delivered'
            : false;

    let setFulfilledAt = false;
    if (becameShipped && ctx.autoFulfillOnShipped && !ctx.fulfilledAt) {
        for (const line of lines) {
            if (!line.productId || line.next !== 'active') continue;
            events.push({
                user_id: ctx.userId,
                product_id: line.productId,
                delta_units: -line.quantity,
                event_type: 'order_fulfillment',
                reference_id: line.lineId,
            });
        }
        setFulfilledAt = true;
    }

    return { events, setFulfilledAt };
}
