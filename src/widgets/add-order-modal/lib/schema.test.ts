import { describe, expect, it } from 'vitest';
import { canSubmitOrderLines, orderLineQuantitySchema, parseOrderLineQuantity } from './schema';

describe('orderLineQuantitySchema', () => {
    it('accepts positive integers', () => {
        expect(orderLineQuantitySchema.parse('1')).toBe(1);
        expect(orderLineQuantitySchema.parse('12')).toBe(12);
    });

    it('rejects zero, negative, empty, and non-integers', () => {
        for (const raw of ['0', '-1', '', '1.5', 'abc', ' ']) {
            expect(orderLineQuantitySchema.safeParse(raw).success).toBe(false);
        }
    });
});

describe('parseOrderLineQuantity', () => {
    it('returns null for quantity 0', () => {
        expect(parseOrderLineQuantity('0')).toBeNull();
    });

    it('returns the integer for quantity >= 1', () => {
        expect(parseOrderLineQuantity('3')).toBe(3);
    });
});

describe('canSubmitOrderLines', () => {
    it('rejects a selected product with quantity 0', () => {
        expect(canSubmitOrderLines([{ productId: 'p1', quantity: '0' }])).toBe(false);
    });

    it('does not silently drop a zero-qty line when another line is valid', () => {
        expect(
            canSubmitOrderLines([
                { productId: 'p1', quantity: '1' },
                { productId: 'p2', quantity: '0' },
            ]),
        ).toBe(false);
    });

    it('rejects when any line has non-positive quantity even without a product', () => {
        expect(
            canSubmitOrderLines([
                { productId: 'p1', quantity: '1' },
                { productId: '', quantity: '0' },
            ]),
        ).toBe(false);
    });

    it('accepts a selected product with quantity >= 1', () => {
        expect(canSubmitOrderLines([{ productId: 'p1', quantity: '1' }])).toBe(true);
    });

    it('allows an extra empty product row when its quantity is valid', () => {
        expect(
            canSubmitOrderLines([
                { productId: 'p1', quantity: '1' },
                { productId: '', quantity: '1' },
            ]),
        ).toBe(true);
    });

    it('rejects when no product is selected', () => {
        expect(canSubmitOrderLines([{ productId: '', quantity: '1' }])).toBe(false);
    });
});
