import { describe, expect, it } from 'vitest';
import { cafe24Line, cafe24Order, lineById, mapCafe24From } from './cafe24-test-fixtures.ts';
import { mapCafe24Order } from './cafe24.ts';

describe('mapCafe24Order item status (#901)', () => {
    it('maps C40 lines to cancelled while the order stays paid on partial cancel', () => {
        const order = mapCafe24From({
            canceled: 'F',
            items: [
                cafe24Line('line-active', 'N20', 1, { product_name: 'A' }),
                cafe24Line('line-c40-a', 'C40', 2, { product_name: 'B' }),
                cafe24Line('line-c40-b', 'C40', 2, { product_name: 'C' }),
            ],
        });
        expect(order?.status).toBe('paid');
        const byId = lineById(order);
        expect(byId.get('line-active')?.status).toBe('active');
        expect(byId.get('line-c40-a')?.status).toBe('cancelled');
        expect(byId.get('line-c40-b')?.status).toBe('cancelled');
        expect(byId.get('line-c40-a')?.quantity).toBe(2);
    });

    it('keeps partial cancel lines cancelled when canceled is M', () => {
        const order = mapCafe24From({
            canceled: 'M',
            items: [cafe24Line('line-active', 'N20', 1), cafe24Line('line-c40', 'C40', 2)],
        });
        expect(order?.status).toBe('paid');
        expect(order?.lines.find((l) => l.platformLineId === 'line-c40')?.status).toBe('cancelled');
    });

    it('maps order-level cancel to every line when items lack codes', () => {
        const order = mapCafe24From({
            canceled: 'T',
            items: [{ order_item_code: 'line-1', quantity: 1 }],
        });
        expect(order?.status).toBe('cancelled');
        expect(order?.lines.every((l) => l.status === 'cancelled')).toBe(true);
    });

    it('maps every line cancelled on a fully cancelled order even with in-progress item codes', () => {
        const order = mapCafe24From({
            canceled: 'T',
            order_status: 'C40',
            items: [cafe24Line('line-n20', 'N20', 1), cafe24Line('line-c00', 'C00', 0)],
        });
        expect(order?.status).toBe('cancelled');
        expect(order?.lines.every((l) => l.status === 'cancelled')).toBe(true);
        expect(order?.lines.every((l) => l.quantity >= 1)).toBe(true);
    });

    it('does not promote order-level R40 to a refunded header; lines keep item codes', () => {
        const order = mapCafe24From({
            order_status: 'R40',
            items: [cafe24Line('line-n20', 'N20', 1), cafe24Line('line-r00', 'R00', 0)],
        });
        expect(order?.status).toBe('paid');
        const byId = lineById(order);
        expect(byId.get('line-n20')?.status).toBe('active');
        expect(byId.get('line-r00')?.status).toBe('active');
        expect(byId.get('line-r00')?.quantity).toBe(0);
    });

    it('maps R40 to refunded lines without forcing the header refunded', () => {
        const order = mapCafe24From({
            items: [cafe24Line('line-r40', 'R40', 1)],
        });
        expect(order?.status).toBe('paid');
        expect(order?.lines[0]?.status).toBe('refunded');
    });

    it('keeps in-progress claim codes active', () => {
        for (const code of ['C00', 'C10', 'C34', 'C36', 'E40']) {
            const order = mapCafe24From({ items: [cafe24Line(`line-${code}`, code, 1)] });
            expect(order?.lines[0]?.status).toBe('active');
        }
    });

    it('does not infer cancel from Korean or English status text alone', () => {
        for (const status_text of ['취소완료', 'already cancelled']) {
            const order = mapCafe24From({
                items: [{ order_item_code: 'line-text', status_text, quantity: 1 }],
            });
            expect(order?.lines[0]?.status).toBe('active');
        }
    });

    it('uses quantity 1 for terminal lines when platform sends 0', () => {
        const order = mapCafe24From({ items: [cafe24Line('line-c40', 'C40', 0)] });
        expect(order?.lines[0]?.status).toBe('cancelled');
        expect(order?.lines[0]?.quantity).toBe(1);
    });

    it('is stable across duplicate mapping of the same payload', () => {
        const raw = cafe24Order({
            items: [cafe24Line('line-active', 'N20', 1), cafe24Line('line-c40', 'C40', 2)],
        });
        expect(mapCafe24Order(raw)).toEqual(mapCafe24Order(raw));
    });
});
