/**
 * Upsert canonical orders into orders/order_lines.
 * Service-role Supabase client required (writes any user's rows).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { planInboundStockActions } from './inbound-actions.ts';
import { mergeStatus } from './status-map.ts';
import type { CanonicalOrder, CanonicalStatus, LineStatus, Platform } from './types.ts';

export interface UpsertContext {
    userId: string;
    connectionId: string;
    platform: Platform;
    autoFulfillOnShipped?: boolean;
}

export interface UpsertResult {
    upserted: number;
    cancelledCompensations: number;
    autoFulfillments: number;
}

type OrderRow = {
    id: string;
    status: string;
    fulfilled_at: string | null;
};

type LineRow = {
    id: string;
    platform_line_id: string;
    product_id: string | null;
    quantity: number;
    status: string;
};

/** Map platform product id → local product via products.sku matching platform product/variant id or sku. */
async function buildProductMap(
    supabase: SupabaseClient,
    userId: string,
    orders: CanonicalOrder[],
): Promise<Map<string, string>> {
    const keys = new Set<string>();
    for (const o of orders) {
        for (const l of o.lines) {
            if (l.platformProductId) keys.add(l.platformProductId);
            if (l.platformVariantId) keys.add(l.platformVariantId);
        }
    }
    if (!keys.size) return new Map();

    const { data: products } = await supabase
        .from('products')
        .select('id, sku')
        .eq('user_id', userId)
        .not('sku', 'is', null);

    const map = new Map<string, string>();
    for (const p of products ?? []) {
        if (p.sku && keys.has(p.sku)) map.set(p.sku, p.id);
    }
    return map;
}

function resolveProductId(
    productMap: Map<string, string>,
    platformProductId: string | null,
    platformVariantId: string | null,
): string | null {
    if (platformVariantId && productMap.has(platformVariantId)) return productMap.get(platformVariantId)!;
    if (platformProductId && productMap.has(platformProductId)) return productMap.get(platformProductId)!;
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
    if (!orders.length) return { upserted: 0, cancelledCompensations: 0, autoFulfillments: 0 };

    const productMap = await buildProductMap(supabase, ctx.userId, orders);
    let upserted = 0;
    let cancelledCompensations = 0;
    let autoFulfillments = 0;
    const now = new Date().toISOString();
    const autoFulfill = ctx.autoFulfillOnShipped === true;

    for (const order of orders) {
        const { data: existing } = await supabase
            .from('orders')
            .select('id, status, fulfilled_at')
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

        const lineByPlatform = new Map(
            ((existingLines ?? []) as LineRow[]).map((l) => [l.platform_line_id, l]),
        );

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
            const productId =
                prevLine?.product_id ??
                resolveProductId(productMap, line.platformProductId, line.platformVariantId);

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

        if (planned.events.length) {
            const { error } = await supabase.rpc('insert_product_stock_events_batch', {
                p_events: planned.events,
            });
            if (error) throw error;
            cancelledCompensations += planned.events.filter((e) => e.event_type === 'order_cancel').length;
            autoFulfillments += planned.events.filter((e) => e.event_type === 'order_fulfillment').length;
        }

        if (planned.setFulfilledAt) {
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

    return { upserted, cancelledCompensations, autoFulfillments };
}
