/**
 * Upsert canonical orders into orders/order_lines.
 * Service-role Supabase client required (writes any user's rows).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { mergeStatus } from './status-map.ts';
import type { CanonicalOrder, CanonicalStatus, LineStatus, Platform } from './types.ts';

export interface UpsertContext {
    userId: string;
    connectionId: string;
    platform: Platform;
}

export interface UpsertResult {
    upserted: number;
    cancelledCompensations: number;
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

export async function upsertCanonicalOrders(
    supabase: SupabaseClient,
    ctx: UpsertContext,
    orders: CanonicalOrder[],
): Promise<UpsertResult> {
    if (!orders.length) return { upserted: 0, cancelledCompensations: 0 };

    const productMap = await buildProductMap(supabase, ctx.userId, orders);
    let upserted = 0;
    let cancelledCompensations = 0;
    const now = new Date().toISOString();

    for (const order of orders) {
        const { data: existing } = await supabase
            .from('orders')
            .select('id, status, fulfilled_at')
            .eq('user_id', ctx.userId)
            .eq('platform', ctx.platform)
            .eq('platform_order_id', order.platformOrderId)
            .maybeSingle();

        const prev = existing as OrderRow | null;
        const nextStatus = prev
            ? mergeStatus(prev.status as CanonicalStatus, order.status)
            : order.status;

        let orderId: string;

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

        const cancelEvents: Array<{
            user_id: string;
            product_id: string;
            delta_units: number;
            event_type: string;
            reference_id: string;
        }> = [];

        for (const line of order.lines) {
            const prevLine = lineByPlatform.get(line.platformLineId);
            const productId =
                prevLine?.product_id ??
                resolveProductId(productMap, line.platformProductId, line.platformVariantId);

            if (prevLine) {
                const prevStatus = prevLine.status as LineStatus;
                const nextLineStatus = line.status;

                // fulfilled order + line cancelled/refunded → compensate stock
                if (
                    prev &&
                    prev.fulfilled_at &&
                    prevStatus === 'active' &&
                    (nextLineStatus === 'cancelled' || nextLineStatus === 'refunded') &&
                    productId
                ) {
                    cancelEvents.push({
                        user_id: ctx.userId,
                        product_id: productId,
                        delta_units: prevLine.quantity,
                        event_type: 'order_cancel',
                        reference_id: prevLine.id,
                    });
                }

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
                const { error } = await supabase.from('order_lines').insert({
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
                });
                if (error) throw error;
            }
        }

        if (cancelEvents.length) {
            const { error } = await supabase.rpc('insert_product_stock_events_batch', {
                p_events: cancelEvents,
            });
            if (error) throw error;
            cancelledCompensations += cancelEvents.length;
        }

        upserted += 1;
    }

    return { upserted, cancelledCompensations };
}
