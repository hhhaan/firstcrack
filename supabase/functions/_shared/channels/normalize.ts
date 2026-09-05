/**
 * Upsert canonical orders into orders/order_lines.
 * Service-role Supabase client required (writes any user's rows).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { planInboundStockActions } from './inbound-actions.ts';
import { mergeStatus } from './status-map.ts';
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

/** Shape of insert_product_stock_events_batch's jsonb return (20260802000002). */
type BatchInsertReturn = {
    skipped?: Array<{
        reference_id?: string;
        order_id?: string;
        order_status?: string;
        reason?: string;
    }>;
} | null;

function parseBatchSkips(data: BatchInsertReturn): StockEventSkip[] {
    return (data?.skipped ?? []).map((s) => ({
        referenceId: String(s.reference_id ?? ''),
        orderId: String(s.order_id ?? ''),
        orderStatus: String(s.order_status ?? ''),
        reason: String(s.reason ?? ''),
    }));
}

type OrderRow = {
    id: string;
    status: string;
    fulfilled_at: string | null;
    ordered_at: string | null;
};

/**
 * `orders.ordered_at` is NOT NULL, so a degraded sync (Naver's last-changed-only fallback) has to
 * write `now()` when the platform gave it nothing. Keeping the earliest value ever seen lets a
 * later, complete sync repair that fabricated timestamp, and never the other way round.
 */
export function earliestOrderedAt(stored: string | null | undefined, incoming: string): string {
    if (!stored) return incoming;
    const storedMs = Date.parse(stored);
    const incomingMs = Date.parse(incoming);
    if (!Number.isFinite(incomingMs)) return stored;
    if (!Number.isFinite(storedMs)) return incoming;
    return incomingMs < storedMs ? incoming : stored;
}

type LineRow = {
    id: string;
    platform_line_id: string;
    product_id: string | null;
    quantity: number;
    status: string;
};

/**
 * Values a line may be matched against `products.sku`, highest priority first.
 *
 * The platform's internal variant/product ids stay ahead of the merchant SKU so existing
 * id-based mappings keep resolving exactly as before; the SKU (Shopify reports one per line)
 * is only a fallback for lines those ids miss.
 *
 * `buildProductMap` collects and `resolveProductId` looks up through this same list — the
 * lookup can never consider a key the collection pass did not fetch.
 */
/** Line quantity: 0 stays 0 (order-edit removals, #317); missing/junk → 1. */
/** Line status derived from the order-level status: only cancel/refund propagate to lines. */
export function lineStatusOf(status: CanonicalStatus): LineStatus {
    return status === 'cancelled' ? 'cancelled' : status === 'refunded' ? 'refunded' : 'active';
}

/** Shopify GID (`gid://shopify/Order/123`) → numeric REST id (`123`). */
export function gidToId(gid: string): string {
    const parts = gid.split('/');
    return parts[parts.length - 1] ?? gid;
}

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

    const { data: mappings, error: mapErr } = await supabase
        .from('product_channel_skus')
        .select('external_key, product_id')
        .eq('user_id', userId)
        .eq('platform', platform)
        .in('external_key', [...keys]);
    if (mapErr) console.error('[normalize] product_channel_skus lookup failed', mapErr.message);
    for (const m of mappings ?? []) {
        if (m.external_key && m.product_id) map.set(m.external_key, m.product_id);
    }

    const { data: products } = await supabase
        .from('products')
        .select('id, sku')
        .eq('user_id', userId)
        .not('sku', 'is', null);
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

async function confirmDispatchIfShipped(
    supabase: SupabaseClient,
    orderId: string,
    status: CanonicalStatus,
): Promise<void> {
    if (status !== 'shipped' && status !== 'delivered') return;
    const now = new Date().toISOString();
    await supabase
        .from('order_dispatches')
        .update({
            status: 'confirmed',
            confirmed_at: now,
            updated_at: now,
        })
        .eq('order_id', orderId)
        .eq('status', 'sent');
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
    let upserted = 0;
    let cancelledCompensations = 0;
    let autoFulfillments = 0;
    const stockEventSkips: StockEventSkip[] = [];
    const now = new Date().toISOString();
    const autoFulfill = ctx.autoFulfillOnShipped === true;

    for (const order of orders) {
        const { data: existing } = await supabase
            .from('orders')
            .select('id, status, fulfilled_at, ordered_at')
            .eq('user_id', ctx.userId)
            .eq('platform', ctx.platform)
            .eq('platform_order_id', order.platformOrderId)
            .maybeSingle();

        const prev = existing as OrderRow | null;
        const prevStatus = (prev?.status as CanonicalStatus) ?? order.status;
        const nextStatus = prev ? mergeStatus(prev.status as CanonicalStatus, order.status) : order.status;

        let orderId: string;
        let fulfilledAt = prev?.fulfilled_at ?? null;

        if (prev) {
            const { error } = await supabase
                .from('orders')
                .update({
                    status: nextStatus,
                    connection_id: ctx.connectionId,
                    ordered_at: earliestOrderedAt(prev.ordered_at, order.orderedAt),
                    buyer_name: order.buyerName,
                    currency: order.currency,
                    total_amount: order.totalAmount,
                    raw: order.raw as Record<string, unknown>,
                    synced_at: now,
                    updated_at: now,
                })
                .eq('id', prev.id);
            if (error) throw error;
            orderId = prev.id;
        } else {
            const { data: created, error } = await supabase
                .from('orders')
                .insert({
                    user_id: ctx.userId,
                    connection_id: ctx.connectionId,
                    platform: ctx.platform,
                    platform_order_id: order.platformOrderId,
                    status: nextStatus,
                    ordered_at: order.orderedAt,
                    buyer_name: order.buyerName,
                    currency: order.currency,
                    total_amount: order.totalAmount,
                    raw: order.raw as Record<string, unknown>,
                    synced_at: now,
                })
                .select('id')
                .single();
            if (error) throw error;
            orderId = created!.id;
        }

        const { data: existingLines } = await supabase
            .from('order_lines')
            .select('id, platform_line_id, product_id, quantity, status')
            .eq('order_id', orderId);

        const lineByPlatform = new Map(((existingLines ?? []) as LineRow[]).map((l) => [l.platform_line_id, l]));

        type DiffLine = {
            lineId: string;
            productId: string | null;
            quantity: number;
            prev: LineStatus;
            next: LineStatus;
        };
        const diffs: DiffLine[] = [];

        for (const line of order.lines) {
            const prevLine = lineByPlatform.get(line.platformLineId);
            // A line first mapped after the order was fulfilled was never deducted; giving it a
            // product now would let a later cancel restore stock that never left (#164).
            const productId = prevLine?.product_id ?? (fulfilledAt ? null : resolveProductId(productMap, line));

            if (prevLine) {
                diffs.push({
                    lineId: prevLine.id,
                    productId,
                    quantity: prevLine.quantity,
                    prev: prevLine.status as LineStatus,
                    next: line.status,
                });

                const { error } = await supabase
                    .from('order_lines')
                    .update({
                        title: line.title,
                        quantity: line.quantity,
                        unit_price: line.unitPrice,
                        status: line.status,
                        platform_product_id: line.platformProductId,
                        platform_variant_id: line.platformVariantId,
                        product_id: productId,
                    })
                    .eq('id', prevLine.id);
                if (error) throw error;
            } else {
                const { data: inserted, error } = await supabase
                    .from('order_lines')
                    .insert({
                        order_id: orderId,
                        user_id: ctx.userId,
                        platform_line_id: line.platformLineId,
                        product_id: productId,
                        platform_product_id: line.platformProductId,
                        platform_variant_id: line.platformVariantId,
                        title: line.title,
                        quantity: line.quantity,
                        unit_price: line.unitPrice,
                        status: line.status,
                    })
                    .select('id')
                    .single();
                if (error) throw error;
                diffs.push({
                    lineId: inserted!.id,
                    productId,
                    quantity: line.quantity,
                    prev: 'active',
                    next: line.status,
                });
            }
        }

        const planned = planInboundStockActions(
            {
                userId: ctx.userId,
                fulfilledAt,
                prevStatus: prev ? prevStatus : 'pending',
                nextStatus,
                autoFulfillOnShipped: autoFulfill,
            },
            diffs,
        );

        const skippedRefs = new Set<string>();
        if (planned.events.length) {
            const { data, error } = await supabase.rpc('insert_product_stock_events_batch', {
                p_events: planned.events,
            });
            if (error) throw error;

            // #109 EF-path guard: the RPC skips (never inserts) fulfillment events whose order
            // went terminal between our read and the locked insert. Surface every skip.
            const skips = parseBatchSkips(data as BatchInsertReturn);
            for (const skip of skips) {
                skippedRefs.add(skip.referenceId);
                stockEventSkips.push(skip);
            }
            if (skips.length) {
                console.error(
                    `[order-sync] stock events skipped for connection ${ctx.connectionId}:`,
                    JSON.stringify(skips),
                );
            }

            cancelledCompensations += planned.events.filter((e) => e.event_type === 'order_cancel').length;
            autoFulfillments += planned.events.filter(
                (e) => e.event_type === 'order_fulfillment' && !skippedRefs.has(e.reference_id),
            ).length;
        }

        // Never stamp fulfilled_at when the terminal guard skipped every planned deduction —
        // a fulfilled_at without fulfillment events would later gate an order_cancel restore
        // that has nothing to compensate (phantom +stock).
        const fulfillmentPlanned = planned.events.filter((e) => e.event_type === 'order_fulfillment');
        const allFulfillmentsSkipped =
            fulfillmentPlanned.length > 0 && fulfillmentPlanned.every((e) => skippedRefs.has(e.reference_id));

        if (planned.setFulfilledAt && !allFulfillmentsSkipped) {
            const { error } = await supabase
                .from('orders')
                .update({ fulfilled_at: now, updated_at: now })
                .eq('id', orderId)
                .is('fulfilled_at', null);
            if (error) throw error;
            fulfilledAt = now;
        }

        await confirmDispatchIfShipped(supabase, orderId, nextStatus);

        upserted += 1;
    }

    return { upserted, cancelledCompensations, autoFulfillments, stockEventSkips };
}
