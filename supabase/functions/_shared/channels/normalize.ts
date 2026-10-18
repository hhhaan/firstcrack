/**
 * Upsert canonical orders into orders/order_lines.
 * Service-role Supabase client required (writes any user's rows).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { captureEdgeException } from '../sentry.ts';
import type { CanonicalOrder, CanonicalOrderLine, CanonicalStatus, LineStatus, Platform } from './types.ts';

export interface UpsertContext {
    userId: string;
    connectionId: string;
    platform: Platform;
    autoFulfillOnShipped?: boolean;
}

/** One stock event the batch RPC refused to insert (#109 EF-path terminal guard). */
export interface StockEventSkip {
    referenceId: string;
    orderId: string;
    orderStatus: string;
    reason: string;
}

export interface UpsertResult {
    upserted: number;
    cancelledCompensations: number;
    autoFulfillments: number;
    /** Never silent: every skip the RPC reported, surfaced into the sync result and logged. */
    stockEventSkips: StockEventSkip[];
}

type BatchSyncReturn = {
    upserted?: number;
    cancelledCompensations?: number;
    autoFulfillments?: number;
    stockEventSkips?: Array<{
        reference_id?: string;
        order_id?: string;
        order_status?: string;
        reason?: string;
    }>;
};

function parseBatchResult(data: unknown): UpsertResult {
    const result = data as BatchSyncReturn | null;
    if (
        !result ||
        !Number.isInteger(result.upserted) ||
        !Number.isInteger(result.cancelledCompensations) ||
        !Number.isInteger(result.autoFulfillments) ||
        !Array.isArray(result.stockEventSkips) ||
        result.stockEventSkips.some(
            (skip) =>
                !skip ||
                typeof skip.reference_id !== 'string' ||
                typeof skip.order_id !== 'string' ||
                typeof skip.order_status !== 'string' ||
                typeof skip.reason !== 'string',
        )
    ) {
        throw new Error('invalid sync_channel_orders_batch result');
    }
    const valid = result as {
        upserted: number;
        cancelledCompensations: number;
        autoFulfillments: number;
        stockEventSkips: Array<{ reference_id: string; order_id: string; order_status: string; reason: string }>;
    };
    return {
        upserted: valid.upserted,
        cancelledCompensations: valid.cancelledCompensations,
        autoFulfillments: valid.autoFulfillments,
        stockEventSkips: valid.stockEventSkips.map((s) => ({
            referenceId: s.reference_id,
            orderId: s.order_id,
            orderStatus: s.order_status,
            reason: s.reason,
        })),
    };
}

/** Line status derived from the order-level status: only cancel/refund propagate to lines. */
export function lineStatusOf(status: CanonicalStatus): LineStatus {
    return status === 'cancelled' ? 'cancelled' : status === 'refunded' ? 'refunded' : 'active';
}

/** Shopify GID (`gid://shopify/Order/123`) → numeric REST id (`123`). */
export function gidToId(gid: string): string {
    const parts = gid.split('/');
    return parts[parts.length - 1] ?? gid;
}

/** Line quantity: 0 stays 0 (order-edit removals, #317); missing/junk → 1. */
export function lineQuantity(v: unknown): number {
    const n = Number(v ?? 1);
    return Number.isFinite(n) ? n : 1;
}

export function lineMatchKeys(line: CanonicalOrderLine): string[] {
    const keys: string[] = [];
    if (line.platformVariantId) keys.push(line.platformVariantId);
    if (line.platformProductId) keys.push(line.platformProductId);
    if (line.sku) keys.push(line.sku);
    return keys;
}

/**
 * Map platform product id / variant id / SKU → local product id.
 *
 * `product_channel_skus` (#164, scoped to this platform) wins; `products.sku` exact match stays
 * as the fallback so mappings made before the table existed keep resolving. A failed table read
 * degrades to the fallback instead of failing the whole sync (the migration may lag the EF).
 */
export async function buildProductMap(
    supabase: SupabaseClient,
    userId: string,
    platform: Platform,
    orders: CanonicalOrder[],
): Promise<Map<string, string>> {
    const keys = new Set<string>();
    for (const o of orders) {
        for (const l of o.lines) {
            for (const k of lineMatchKeys(l)) keys.add(k);
        }
    }
    if (!keys.size) return new Map();

    const map = new Map<string, string>();

    // Whole (user, platform) slice, filtered here: an `.in(keys)` on a backfill sync (hundreds of
    // orders × 3 keys) overflows the query string and the fail-soft below would mask exactly the
    // syncs #164 is for. The table is tiny per user, and products is already fetched the same way.
    const { data: mappings, error: mapErr } = await supabase
        .from('product_channel_skus')
        .select('external_key, product_id')
        .eq('user_id', userId)
        .eq('platform', platform);
    if (mapErr) {
        console.error('[normalize] product_channel_skus lookup failed', mapErr.message);
        await captureEdgeException(mapErr, {
            function: 'order-sync',
            status: 500,
            tags: { platform, step: 'product-channel-skus' },
        });
    }
    for (const m of mappings ?? []) {
        if (m.external_key && m.product_id && keys.has(m.external_key)) map.set(m.external_key, m.product_id);
    }

    const { data: products, error: productErr } = await supabase
        .from('products')
        .select('id, sku')
        .eq('user_id', userId)
        .not('sku', 'is', null);
    if (productErr) {
        console.error('[normalize] products sku lookup failed', productErr.message);
        await captureEdgeException(productErr, {
            function: 'order-sync',
            status: 500,
            tags: { platform, step: 'products-sku' },
        });
    }
    for (const p of products ?? []) {
        if (p.sku && keys.has(p.sku) && !map.has(p.sku)) map.set(p.sku, p.id);
    }
    return map;
}

export function resolveProductId(productMap: Map<string, string>, line: CanonicalOrderLine): string | null {
    for (const key of lineMatchKeys(line)) {
        const productId = productMap.get(key);
        if (productId) return productId;
    }
    return null;
}

export async function upsertCanonicalOrders(
    supabase: SupabaseClient,
    ctx: UpsertContext,
    orders: CanonicalOrder[],
): Promise<UpsertResult> {
    if (!orders.length) {
        return { upserted: 0, cancelledCompensations: 0, autoFulfillments: 0, stockEventSkips: [] };
    }

    const productMap = await buildProductMap(supabase, ctx.userId, ctx.platform, orders);
    const result: UpsertResult = {
        upserted: 0,
        cancelledCompensations: 0,
        autoFulfillments: 0,
        stockEventSkips: [],
    };
    const stockEventSkips: StockEventSkip[] = [];
    for (let i = 0; i < orders.length; i += 100) {
        const batch = orders.slice(i, i + 100).map((order) => ({
            ...order,
            lines: order.lines.map((line) => ({ ...line, productId: resolveProductId(productMap, line) })),
        }));
        const { data, error } = await supabase.rpc('sync_channel_orders_batch', {
            p_user_id: ctx.userId,
            p_connection_id: ctx.connectionId,
            p_orders: batch,
        });
        if (error) throw new Error(error.message, { cause: error });
        const batchResult = parseBatchResult(data);
        result.upserted += batchResult.upserted;
        result.cancelledCompensations += batchResult.cancelledCompensations;
        result.autoFulfillments += batchResult.autoFulfillments;
        stockEventSkips.push(...batchResult.stockEventSkips);

        if (batchResult.stockEventSkips.length) {
            console.error(
                `[order-sync] stock events skipped for connection ${ctx.connectionId}:`,
                JSON.stringify(batchResult.stockEventSkips),
            );
            await captureEdgeException(new Error(`stock events skipped: ${batchResult.stockEventSkips.length}`), {
                function: 'order-sync',
                status: 500,
                level: 'warning',
                tags: { platform: ctx.platform, step: 'stock-event-skip' },
                extra: {
                    connectionId: ctx.connectionId,
                    skips: batchResult.stockEventSkips.map((skip) => ({
                        referenceId: skip.referenceId,
                        reason: skip.reason,
                        orderStatus: skip.orderStatus,
                    })),
                },
            });
        }
    }
    result.stockEventSkips = stockEventSkips;
    return result;
}
