import { describe, expect, it } from 'vitest';
import { naverCommercialQuantity, naverPaymentAmount, mergeNaverOrdersByOrderId } from './naver-order.ts';
import type { CanonicalOrder } from './types.ts';

function part(overrides: Partial<CanonicalOrder> & Pick<CanonicalOrder, 'status' | 'lines'>): CanonicalOrder {
    return {
        platformOrderId: 'order-1',
        orderedAt: '2026-10-10T00:00:00.000Z',
        buyerName: null,
        currency: 'KRW',
        totalAmount: null,
        raw: {},
        ...overrides,
    };
}

describe('mergeNaverOrdersByOrderId', () => {
    it('keeps the order open when one product order is cancelled', () => {
        const [order] = mergeNaverOrdersByOrderId([
            part({
                status: 'paid',
                totalAmount: 2000,
                lines: [
                    {
                        platformLineId: 'a',
                        platformProductId: null,
                        platformVariantId: null,
                        title: 'A',
                        quantity: 1,
                        unitPrice: 2000,
                        status: 'active',
                    },
                ],
            }),
            part({
                status: 'cancelled',
                totalAmount: 0,
                lines: [
                    {
                        platformLineId: 'b',
                        platformProductId: null,
                        platformVariantId: null,
                        title: 'B',
                        quantity: 1,
                        unitPrice: 3000,
                        status: 'cancelled',
                    },
                ],
            }),
        ]);
        expect(order.status).toBe('paid');
        expect(order.lines.map((line) => line.status)).toEqual(['active', 'cancelled']);
        expect(order.totalAmount).toBe(5000);
    });

    it('cancels the order only when every line is terminal', () => {
        const [order] = mergeNaverOrdersByOrderId([
            part({
                status: 'cancelled',
                lines: [
                    {
                        platformLineId: 'a',
                        platformProductId: null,
                        platformVariantId: null,
                        title: 'A',
                        quantity: 1,
                        unitPrice: 1,
                        status: 'cancelled',
                    },
                ],
            }),
            part({
                status: 'refunded',
                lines: [
                    {
                        platformLineId: 'b',
                        platformProductId: null,
                        platformVariantId: null,
                        title: 'B',
                        quantity: 1,
                        unitPrice: 1,
                        status: 'refunded',
                    },
                ],
            }),
        ]);
        expect(order.status).toBe('refunded');
    });

    it('keeps the furthest forward status among the lines that are still active', () => {
        const [order] = mergeNaverOrdersByOrderId([
            part({
                status: 'shipped',
                lines: [
                    {
                        platformLineId: 'a',
                        platformProductId: null,
                        platformVariantId: null,
                        title: 'A',
                        quantity: 1,
                        unitPrice: 1,
                        status: 'active',
                    },
                ],
            }),
            part({
                status: 'cancelled',
                lines: [
                    {
                        platformLineId: 'b',
                        platformProductId: null,
                        platformVariantId: null,
                        title: 'B',
                        quantity: 1,
                        unitPrice: 1,
                        status: 'cancelled',
                    },
                ],
            }),
        ]);
        expect(order.status).toBe('shipped');
    });
});

describe('naver commercial amounts', () => {
    it('uses the ordered quantity and payment after a line cancel', () => {
        const po = {
            remainQuantity: 0,
            quantity: 0,
            initialQuantity: 2,
            remainPaymentAmount: 0,
            totalPaymentAmount: 0,
            initialPaymentAmount: 4000,
        };
        expect(naverCommercialQuantity(po, true)).toBe(2);
        expect(naverPaymentAmount(po, true)).toBe(4000);
    });

    it('uses the remaining quantity while the line is active', () => {
        const po = { remainQuantity: 1, quantity: 2, initialQuantity: 2, remainPaymentAmount: 1500 };
        expect(naverCommercialQuantity(po, false)).toBe(1);
        expect(naverPaymentAmount(po, false)).toBe(1500);
    });
});
