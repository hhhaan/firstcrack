import { describe, expect, it } from 'vitest';
import { buildProductMap, earliestOrderedAt, resolveProductId } from './normalize.ts';
import type { CanonicalOrder, CanonicalOrderLine } from './types.ts';

describe('earliestOrderedAt (#125 degraded sync poisons ordered_at)', () => {
    const real = '2026-07-20T03:00:00.000Z';
    const fabricatedNow = '2026-07-26T09:00:00.000Z';

    it('takes the incoming value for a brand new order', () => {
        expect(earliestOrderedAt(null, real)).toBe(real);
    });

    it('repairs a fabricated `now` once the real timestamp arrives', () => {
        expect(earliestOrderedAt(fabricatedNow, real)).toBe(real);
    });

    it('cannot be re-poisoned by a later degraded sync', () => {
        expect(earliestOrderedAt(real, fabricatedNow)).toBe(real);
    });

    it('keeps the stored value when the incoming one is unparseable', () => {
        expect(earliestOrderedAt(real, 'garbage')).toBe(real);
    });

    it('replaces an unparseable stored value', () => {
        expect(earliestOrderedAt('garbage', real)).toBe(real);
    });
});

describe('product matching (#131 unmapped lines silently skip stock deduction)', () => {
    type ProductRow = { id: string; sku: string | null };
    type Supabase = Parameters<typeof buildProductMap>[0];

    /** Stands in for `.from('products').select().eq().not()`. */
    const fakeSupabase = (products: ProductRow[]): Supabase =>
        ({
            from: () => ({
                select: () => ({
                    eq: () => ({ not: () => Promise.resolve({ data: products }) }),
                }),
            }),
        }) as unknown as Supabase;

    const line = (over: Partial<CanonicalOrderLine>): CanonicalOrderLine => ({
        platformLineId: 'L1',
        platformProductId: null,
        platformVariantId: null,
        title: 'Ethiopia 200g',
        quantity: 1,
        unitPrice: null,
        status: 'active',
        ...over,
    });

    /** Full path: collect keys from the order → fetch products → resolve the line. */
    const match = async (l: CanonicalOrderLine, products: ProductRow[]) => {
        const order = { lines: [l] } as CanonicalOrder;
        const map = await buildProductMap(fakeSupabase(products), 'user-1', [order]);
        return resolveProductId(map, l);
    };

    it('still matches a platform variant id (regression)', async () => {
        const l = line({ platformProductId: 'P-1', platformVariantId: 'V-1' });
        await expect(match(l, [{ id: 'prod-v', sku: 'V-1' }])).resolves.toBe('prod-v');
    });

    it('still matches a platform product id (regression)', async () => {
        const l = line({ platformProductId: 'P-1', platformVariantId: 'V-1' });
        await expect(match(l, [{ id: 'prod-p', sku: 'P-1' }])).resolves.toBe('prod-p');
    });

    it('matches the Shopify variant SKU when no internal id maps', async () => {
        const l = line({ platformProductId: 'P-1', platformVariantId: 'V-1', sku: 'ETH-200' });
        await expect(match(l, [{ id: 'prod-sku', sku: 'ETH-200' }])).resolves.toBe('prod-sku');
    });

    it('keeps the internal id ahead of the SKU when both map', async () => {
        const l = line({ platformProductId: 'P-1', platformVariantId: 'V-1', sku: 'ETH-200' });
        const products = [
            { id: 'prod-sku', sku: 'ETH-200' },
            { id: 'prod-v', sku: 'V-1' },
        ];
        await expect(match(l, products)).resolves.toBe('prod-v');
    });

    it('leaves product_id null when nothing matches', async () => {
        const l = line({ platformProductId: 'P-1', platformVariantId: 'V-1', sku: 'ETH-200' });
        await expect(match(l, [{ id: 'other', sku: 'KEN-500' }])).resolves.toBeNull();
    });

    it('ignores an empty SKU instead of matching a blank product sku', async () => {
        const l = line({ sku: '' });
        await expect(match(l, [{ id: 'blank', sku: '' }])).resolves.toBeNull();
    });
});
