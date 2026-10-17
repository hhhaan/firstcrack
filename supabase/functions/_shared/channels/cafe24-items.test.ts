import { describe, expect, it } from 'vitest';
import { mapCafe24Order } from './cafe24.ts';

function cafe24Order(over: Record<string, unknown> = {}) {
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

describe('mapCafe24Order item status (#901)', () => {
    it('maps C40 lines to cancelled while the order stays paid on partial cancel', () => {
        const order = mapCafe24Order(
            cafe24Order({
                canceled: 'F',
                items: [
                    { order_item_code: 'line-active', order_status: 'N20', quantity: 1, product_name: 'A' },
                    { order_item_code: 'line-c40-a', order_status: 'C40', quantity: 2, product_name: 'B' },
                    { order_item_code: 'line-c40-b', order_status: 'C40', quantity: 2, product_name: 'C' },
                ],
            }),
        );
        expect(order?.status).toBe('paid');
        const byId = new Map(order?.lines.map((l) => [l.platformLineId, l]));
        expect(byId.get('line-active')?.status).toBe('active');
        expect(byId.get('line-c40-a')?.status).toBe('cancelled');
        expect(byId.get('line-c40-b')?.status).toBe('cancelled');
        expect(byId.get('line-c40-a')?.quantity).toBe(2);
    });

    it('keeps partial cancel lines cancelled when canceled is M', () => {
        const order = mapCafe24Order(
            cafe24Order({
                canceled: 'M',
                items: [
                    { order_item_code: 'line-active', order_status: 'N20', quantity: 1 },
                    { order_item_code: 'line-c40', order_status: 'C40', quantity: 2 },
                ],
            }),
        );
        expect(order?.status).toBe('paid');
        expect(order?.lines.find((l) => l.platformLineId === 'line-c40')?.status).toBe('cancelled');
    });

    it('maps order-level cancel to every line when items lack codes', () => {
        const order = mapCafe24Order(
            cafe24Order({
                canceled: 'T',
                items: [{ order_item_code: 'line-1', quantity: 1 }],
            }),
        );
        expect(order?.status).toBe('cancelled');
        expect(order?.lines.every((l) => l.status === 'cancelled')).toBe(true);
    });

    it('maps every line cancelled on a fully cancelled order even with in-progress item codes', () => {
        const order = mapCafe24Order(
            cafe24Order({
                canceled: 'T',
                order_status: 'C40',
                items: [
                    { order_item_code: 'line-n20', order_status: 'N20', quantity: 1 },
                    { order_item_code: 'line-c00', order_status: 'C00', quantity: 0 },
                ],
            }),
        );
        expect(order?.status).toBe('cancelled');
        expect(order?.lines.every((l) => l.status === 'cancelled')).toBe(true);
        expect(order?.lines.every((l) => l.quantity >= 1)).toBe(true);
    });

    it('maps every line refunded when the order header is a completed return', () => {
        const order = mapCafe24Order(
            cafe24Order({
                order_status: 'R40',
                items: [
                    { order_item_code: 'line-n20', order_status: 'N20', quantity: 1 },
                    { order_item_code: 'line-r00', order_status: 'R00', quantity: 0 },
                ],
            }),
        );
        expect(order?.status).toBe('refunded');
        expect(order?.lines.every((l) => l.status === 'refunded')).toBe(true);
        expect(order?.lines.every((l) => l.quantity >= 1)).toBe(true);
    });

    it('maps R40 to refunded lines without forcing the header refunded', () => {
        const order = mapCafe24Order(
            cafe24Order({
                items: [{ order_item_code: 'line-r40', order_status: 'R40', quantity: 1 }],
            }),
        );
        expect(order?.status).toBe('paid');
        expect(order?.lines[0]?.status).toBe('refunded');
    });

    it('keeps in-progress claim codes active', () => {
        for (const code of ['C00', 'C10', 'C34', 'C36', 'E40']) {
            const order = mapCafe24Order(
                cafe24Order({
                    items: [{ order_item_code: `line-${code}`, order_status: code, quantity: 1 }],
                }),
            );
            expect(order?.lines[0]?.status).toBe('active');
        }
    });

    it('does not infer cancel from Korean or English status text alone', () => {
        for (const status_text of ['취소완료', 'already cancelled']) {
            const order = mapCafe24Order(
                cafe24Order({
                    items: [{ order_item_code: 'line-text', status_text, quantity: 1 }],
                }),
            );
            expect(order?.lines[0]?.status).toBe('active');
        }
    });

    it('uses quantity 1 for terminal lines when platform sends 0', () => {
        const order = mapCafe24Order(
            cafe24Order({
                items: [{ order_item_code: 'line-c40', order_status: 'C40', quantity: 0 }],
            }),
        );
        expect(order?.lines[0]?.status).toBe('cancelled');
        expect(order?.lines[0]?.quantity).toBe(1);
    });

    it('is stable across duplicate mapping of the same payload', () => {
        const raw = cafe24Order({
            items: [
                { order_item_code: 'line-active', order_status: 'N20', quantity: 1 },
                { order_item_code: 'line-c40', order_status: 'C40', quantity: 2 },
            ],
        });
        const a = mapCafe24Order(raw);
        const b = mapCafe24Order(raw);
        expect(a).toEqual(b);
    });
});
