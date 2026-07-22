import { describe, expect, it } from 'vitest';
import { mapTossPlaceOrder } from './toss-place.ts';

describe('mapTossPlaceOrder', () => {
    it('maps COMPLETED order with line item.code as SKU key', () => {
        const order = mapTossPlaceOrder({
            id: 99,
            orderState: 'COMPLETED',
            createdAt: '2026-07-01T01:00:00Z',
            completedAt: '2026-07-01T01:05:00Z',
            chargePrice: {
                totalAmount: 15000,
                taxAmount: 1364,
                supplyAmount: 13636,
                taxExemptAmount: 0,
            },
            lineItems: [
                {
                    id: 'li-1',
                    quantity: 2,
                    item: { title: 'Ethiopia 200g', code: 'ETH-200' },
                    itemPrice: { priceValue: 7500 },
                },
            ],
            payments: [{ state: 'APPROVED', amount: 15000 }],
        });
        expect(order).not.toBeNull();
        expect(order!.platformOrderId).toBe('99');
        expect(order!.status).toBe('paid');
        expect(order!.currency).toBe('KRW');
        expect(order!.totalAmount).toBe(15000);
        expect(order!.orderedAt).toBe('2026-07-01T01:05:00Z');
        expect(order!.buyerName).toBeNull();
        expect(order!.lines).toHaveLength(1);
        expect(order!.lines[0]).toMatchObject({
            platformLineId: 'li-1',
            platformProductId: 'ETH-200',
            platformVariantId: null,
            title: 'Ethiopia 200g',
            quantity: 2,
            unitPrice: 7500,
            status: 'active',
        });
        expect((order!.raw as { chargePrice: { taxAmount: number } }).chargePrice.taxAmount).toBe(1364);
    });

    it('maps CANCELLED and stable line id fallback', () => {
        const order = mapTossPlaceOrder({
            id: 'ord-2',
            orderState: 'CANCELLED',
            createdAt: '2026-07-02T00:00:00Z',
            orderLineItems: [{ quantity: 1, item: { title: 'Bag' } }],
        });
        expect(order!.status).toBe('cancelled');
        expect(order!.lines[0].status).toBe('cancelled');
        expect(order!.lines[0].platformLineId).toBe('ord-2:0');
        expect(order!.lines[0].platformProductId).toBeNull();
    });

    it('returns null without id', () => {
        expect(mapTossPlaceOrder({ orderState: 'COMPLETED' })).toBeNull();
    });

    it('returns null for UNDEFINED / unknown (never default paid)', () => {
        expect(mapTossPlaceOrder({ id: 1, orderState: 'UNDEFINED' })).toBeNull();
        expect(mapTossPlaceOrder({ id: 1, orderState: 'WEIRD' })).toBeNull();
        expect(mapTossPlaceOrder({ id: 1 })).toBeNull();
    });
});

describe('tossPlaceAdapter capabilities', () => {
    it('is pull-only POS', async () => {
        const { tossPlaceAdapter } = await import('./toss-place.ts');
        expect(tossPlaceAdapter.platform).toBe('toss_place');
        expect(tossPlaceAdapter.capabilities).toEqual({
            webhooks: true,
            outboundDispatch: false,
            channelKind: 'pos',
        });
        const shipped = await tossPlaceAdapter.markShipped({ merchant_id: '1' }, {
            platformOrderId: '1',
            lines: [],
            carrierCode: 'x',
            trackingNumber: 'y',
        });
        expect(shipped.ok).toBe(false);
        expect(shipped.error).toMatch(/not supported/i);
    });
});
