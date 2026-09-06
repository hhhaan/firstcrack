import { describe, expect, it } from 'vitest';
import {
    buildProductMap,
    earliestOrderedAt,
    resolveProductId,
    resolveUpdatedTotalAmount,
} from './normalize.ts';
import type { CanonicalOrder, CanonicalOrderLine } from './types.ts';

describe('resolveUpdatedTotalAmount', () => {
    it('keeps the stored total when Cafe24/Naver omit amount (null)', () => {
        expect(
            resolveUpdatedTotalAmount({
                incoming: null,
                previous: 45000,
                incomingLineCount: 1,
                existingLineCount: 3,
            }),
        ).toBe(45000);
    });

    it('does not shrink a full-order total when a single ProductOrder arrives', () => {
        expect(
            resolveUpdatedTotalAmount({
                incoming: 12000,
                previous: 45000,
                incomingLineCount: 1,
                existingLineCount: 3,
            }),
        ).toBe(45000);
    });

    it('uses the incoming total for a new order or a complete replacement', () => {
        expect(
            resolveUpdatedTotalAmount({
                incoming: 12000,
                previous: null,
                incomingLineCount: 1,
                existingLineCount: 0,
            }),
        ).toBe(12000);
        expect(
            resolveUpdatedTotalAmount({
                incoming: 40000,
                previous: 45000,
                incomingLineCount: 3,
                existingLineCount: 3,
            }),
        ).toBe(40000);
    });
});

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

    type MappingRow = { external_key: string; product_id: string };
    type Fixture = { products: ProductRow[]; mappings?: MappingRow[]; mappingError?: boolean };

    /** Dispatches on table: `products` → `.select().eq().not()`, `product_channel_skus` → `.select().eq().eq()`. */
    const fakeSupabase = (fx: Fixture): Supabase =>
        ({
            from: (table: string) =>
                table === 'products'
                    ? {
                          select: () => ({
                              eq: () => ({ not: () => Promise.resolve({ data: fx.products }) }),
                          }),
                      }
                    : {
                          select: () => ({
                              eq: () => ({
                                  eq: () =>
                                      Promise.resolve(
                                          fx.mappingError
                                              ? { data: null, error: { message: 'relation missing' } }
                                              : { data: fx.mappings ?? [] },
                                      ),
                              }),
                          }),
                      },
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
    const match = async (l: CanonicalOrderLine, products: ProductRow[], extra: Omit<Fixture, 'products'> = {}) => {
        const order = { lines: [l] } as CanonicalOrder;
        const map = await buildProductMap(fakeSupabase({ products, ...extra }), 'user-1', 'shopify', [order]);
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

    it('resolves through product_channel_skus before products.sku (#164)', async () => {
        const l = line({ platformProductId: 'P-1', platformVariantId: 'V-1' });
        const mappings = [{ external_key: 'V-1', product_id: 'prod-mapped' }];
        await expect(match(l, [{ id: 'prod-sku', sku: 'V-1' }], { mappings })).resolves.toBe('prod-mapped');
    });

    it('lets a product carry several channel keys at once (#164)', async () => {
        const mappings = [
            { external_key: 'V-shopify', product_id: 'prod-1' },
            { external_key: 'P-cafe24', product_id: 'prod-1' },
        ];
        const a = line({ platformVariantId: 'V-shopify' });
        const b = line({ platformProductId: 'P-cafe24' });
        await expect(match(a, [], { mappings })).resolves.toBe('prod-1');
        await expect(match(b, [], { mappings })).resolves.toBe('prod-1');
    });

    it('falls back to products.sku when the mapping table read fails', async () => {
        const l = line({ platformVariantId: 'V-1' });
        await expect(match(l, [{ id: 'prod-sku', sku: 'V-1' }], { mappingError: true })).resolves.toBe('prod-sku');
    });
});
