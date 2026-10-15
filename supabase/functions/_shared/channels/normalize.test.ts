import { describe, expect, it } from 'vitest';
import { buildProductMap, resolveProductId, upsertCanonicalOrders } from './normalize.ts';
import type { CanonicalOrder, CanonicalOrderLine } from './types.ts';

describe('sync_channel_orders_batch boundary', () => {
    const order = (i: number): CanonicalOrder => ({
        platformOrderId: `O-${i}`,
        status: 'paid',
        orderedAt: '2026-10-10T00:00:00.000Z',
        buyerName: null,
        currency: 'KRW',
        totalAmount: 1000,
        raw: {},
        lines: [
            {
                platformLineId: `L-${i}`,
                platformProductId: `P-${i}`,
                platformVariantId: null,
                title: 'Coffee',
                quantity: 1,
                unitPrice: 1000,
                status: 'active',
            },
        ],
    });

    it.each([
        [1, 1],
        [10, 1],
        [100, 1],
        [201, 3],
    ])('uses two mapping reads plus chunked RPCs for %i orders', async (count, rpcCount) => {
        const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
        let reads = 0;
        const supabase = {
            from: (_name: string) => {
                reads += 1;
                return {
                    select: () => ({
                        eq: () => ({
                            eq: () => Promise.resolve({ data: [] }),
                            not: () => Promise.resolve({ data: [] }),
                        }),
                    }),
                };
            },
            rpc: (name: string, args: Record<string, unknown>) => {
                calls.push({ name, args });
                return Promise.resolve({
                    data: {
                        upserted: (args.p_orders as CanonicalOrder[]).length,
                        cancelledCompensations: 0,
                        autoFulfillments: 0,
                        stockEventSkips: [],
                        held: [],
                        heldFulfillments: 0,
                    },
                    error: null,
                });
            },
        } as unknown as Parameters<typeof upsertCanonicalOrders>[0];

        await expect(
            upsertCanonicalOrders(
                supabase,
                { userId: 'user-1', connectionId: 'connection-1', platform: 'shopify' },
                Array.from({ length: count }, (_, i) => order(i)),
            ),
        ).resolves.toMatchObject({ upserted: count });
        expect(reads).toBe(2);
        expect(calls).toHaveLength(rpcCount);
        expect(calls.every((call) => call.name === 'sync_channel_orders_batch')).toBe(true);
        expect(calls.every((call) => (call.args.p_orders as CanonicalOrder[]).length <= 100)).toBe(true);
    });

    it('passes resolved product candidates and preserves repeated order ids', async () => {
        const payloads: unknown[] = [];
        const supabase = {
            from: (name: string) => ({
                select: () => ({
                    eq: () => ({
                        eq: () =>
                            Promise.resolve({
                                data:
                                    name === 'product_channel_skus'
                                        ? [{ external_key: 'P-1', product_id: 'prod-1' }]
                                        : [],
                            }),
                        not: () => Promise.resolve({ data: [] }),
                    }),
                }),
            }),
            rpc: (_name: string, args: Record<string, unknown>) => {
                payloads.push(args.p_orders);
                return Promise.resolve({
                    data: {
                        upserted: 2,
                        cancelledCompensations: 0,
                        autoFulfillments: 0,
                        stockEventSkips: [],
                        held: [],
                        heldFulfillments: 0,
                    },
                    error: null,
                });
            },
        } as unknown as Parameters<typeof upsertCanonicalOrders>[0];
        const repeated = [order(1), { ...order(1), status: 'shipped' as const }];

        await upsertCanonicalOrders(
            supabase,
            { userId: 'user-1', connectionId: 'connection-1', platform: 'shopify' },
            repeated,
        );

        const sent = payloads[0] as Array<CanonicalOrder & { lines: Array<{ productId: string | null }> }>;
        expect(sent.map((item) => item.platformOrderId)).toEqual(['O-1', 'O-1']);
        expect(sent[0]?.lines[0]?.productId).toBe('prod-1');
    });
});

describe('parseBatchResult held payloads', () => {
    const heldOrder = (): CanonicalOrder => ({
        platformOrderId: 'O-held',
        status: 'paid',
        orderedAt: '2026-10-10T00:00:00.000Z',
        buyerName: null,
        currency: 'KRW',
        totalAmount: 1000,
        raw: {},
        lines: [
            {
                platformLineId: 'L-held',
                platformProductId: 'P-held',
                platformVariantId: null,
                title: 'Coffee',
                quantity: 1,
                unitPrice: 1000,
                status: 'active',
            },
        ],
    });

    it('maps held fulfillments from RPC snake_case', async () => {
        const supabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        eq: () => Promise.resolve({ data: [] }),
                        not: () => Promise.resolve({ data: [] }),
                    }),
                }),
            }),
            rpc: () =>
                Promise.resolve({
                    data: {
                        upserted: 1,
                        cancelledCompensations: 0,
                        autoFulfillments: 0,
                        stockEventSkips: [],
                        heldFulfillments: 1,
                        held: [
                            {
                                order_id: 'ord-1',
                                platform_order_id: 'ext-1',
                                shortages: [
                                    {
                                        product_id: 'prod-1',
                                        order_line_id: 'line-1',
                                        required_units: 5,
                                        available_units: 1,
                                    },
                                ],
                            },
                        ],
                    },
                    error: null,
                }),
        } as unknown as Parameters<typeof upsertCanonicalOrders>[0];

        await expect(
            upsertCanonicalOrders(
                supabase,
                { userId: 'user-1', connectionId: 'connection-1', platform: 'shopify' },
                [heldOrder()],
            ),
        ).resolves.toMatchObject({
            heldFulfillments: 1,
            fulfillmentHolds: [
                {
                    orderId: 'ord-1',
                    platformOrderId: 'ext-1',
                    shortages: [{ productId: 'prod-1', requiredUnits: 5, availableUnits: 1 }],
                },
            ],
        });
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
