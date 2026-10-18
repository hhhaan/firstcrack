/**
 * Shared Cafe24 adapter test fixtures (vitest only).
 */
import { mapCafe24Order } from './cafe24.ts';
import type { CanonicalOrder } from './types.ts';

export function cafe24Order(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        order_id: '20260727-0000001',
        paid: 'T',
        canceled: 'F',
        order_date: '2026-07-27T10:00:00+09:00',
        currency: 'KRW',
        items: [],
        ...over,
    };
}

export function cafe24Line(
    orderItemCode: string,
    orderStatus: string,
    quantity: number,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return { order_item_code: orderItemCode, order_status: orderStatus, quantity, ...extra };
}

export function mapCafe24From(over: Record<string, unknown> = {}): CanonicalOrder | null {
    return mapCafe24Order(cafe24Order(over));
}

export function lineById(order: CanonicalOrder | null): Map<string, CanonicalOrder['lines'][number]> {
    return new Map(order?.lines.map((l) => [l.platformLineId, l]) ?? []);
}

export function cafe24ShipmentsResponse(shipments: Array<Record<string, unknown>>): Response {
    return new Response(JSON.stringify({ shipments }), { status: 200 });
}

export const CAFE24_ITEMLESS_ORDER_ID = '20200717-0029236';

export function cafe24ItemlessWebhookPayload(): Record<string, unknown> {
    return {
        event_no: 90023,
        order_id: CAFE24_ITEMLESS_ORDER_ID,
        resource: {
            mall_id: 'demo',
            order_id: CAFE24_ITEMLESS_ORDER_ID,
            paid: 'T',
            order_date: '2026-10-16T00:00:00Z',
        },
    };
}

export function cafe24ItemlessDetailOrder(
    items: Array<Record<string, unknown>>,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        order_id: CAFE24_ITEMLESS_ORDER_ID,
        paid: 'T',
        canceled: 'F',
        order_date: '2026-10-16T00:00:00Z',
        actual_order_amount: { order_price_amount: '15000' },
        items,
        ...extra,
    };
}
