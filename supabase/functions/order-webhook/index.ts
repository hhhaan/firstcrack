/**
 * POST /order-webhook?platform=shopify|cafe24
 * Push ingest: verify signature when possible, upsert canonical order, always 200 on handled body.
 *
 * Shopify headers: X-Shopify-Shop-Domain, X-Shopify-Hmac-Sha256, X-Shopify-Topic
 * Cafe24: mall_id in payload; optional CAFE24_WEBHOOK_SECRET header check later.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { jsonResponse } from '../_shared/auth.ts';
import { getAdapter } from '../_shared/channels/adapters.ts';
import { upsertCanonicalOrders } from '../_shared/channels/normalize.ts';
import { cafe24ToCanonical, shopifyToCanonical } from '../_shared/channels/status-map.ts';
import type { CanonicalOrder, CanonicalOrderLine, Platform } from '../_shared/channels/types.ts';

function serviceClient() {
    return createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
}

async function hmacSha256Base64(secret: string, body: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const bytes = new Uint8Array(sig);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

function gidToId(gid: string): string {
    const parts = gid.split('/');
    return parts[parts.length - 1] ?? gid;
}

function parseShopifyOrder(payload: Record<string, unknown>): CanonicalOrder | null {
    const id = payload.id != null ? String(payload.id) : payload.admin_graphql_api_id
        ? gidToId(String(payload.admin_graphql_api_id))
        : '';
    if (!id) return null;

    const financial = payload.financial_status != null ? String(payload.financial_status) : null;
    const fulfillment = payload.fulfillment_status != null ? String(payload.fulfillment_status) : null;
    const cancelledAt = payload.cancelled_at != null ? String(payload.cancelled_at) : null;
    const status =
        shopifyToCanonical(financial, fulfillment, cancelledAt) ?? 'paid';

    const lineItems = (payload.line_items as Array<Record<string, unknown>> | undefined) ?? [];
    const lines: CanonicalOrderLine[] = lineItems.map((li, i) => {
        const lineStatus =
            status === 'cancelled' ? 'cancelled' : status === 'refunded' ? 'refunded' : 'active';
        return {
            platformLineId: li.id != null ? String(li.id) : `${id}-${i}`,
            platformProductId: li.product_id != null ? String(li.product_id) : null,
            platformVariantId: li.variant_id != null ? String(li.variant_id) : null,
            title: String(li.name ?? li.title ?? 'Item'),
            quantity: Number(li.quantity ?? 1) || 1,
            unitPrice: li.price != null ? Number(li.price) : null,
            status: lineStatus as CanonicalOrderLine['status'],
        };
    });

    const customer = payload.customer as { first_name?: string; last_name?: string } | undefined;
    const buyer = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || null;

    return {
        platformOrderId: id,
        status,
        orderedAt: String(payload.created_at ?? new Date().toISOString()),
        buyerName: buyer,
        currency: payload.currency != null ? String(payload.currency) : null,
        totalAmount: payload.total_price != null ? Number(payload.total_price) : null,
        lines,
        raw: payload,
    };
}

function parseCafe24Order(payload: Record<string, unknown>): CanonicalOrder | null {
    const resource = (payload.resource ?? payload.order ?? payload) as Record<string, unknown>;
    const orderId = String(resource.order_id ?? payload.order_id ?? '');
    if (!orderId) return null;

    const status =
        cafe24ToCanonical({
            paid: resource.paid != null ? String(resource.paid) : null,
            canceled: resource.canceled != null ? String(resource.canceled) : null,
            shippingStatus: resource.shipping_status != null ? String(resource.shipping_status) : null,
            processStatus: resource.process_status != null ? String(resource.process_status) : null,
            orderStatus: resource.order_status != null ? String(resource.order_status) : null,
        }) ?? 'paid';

    const items = (resource.items as Array<Record<string, unknown>> | undefined) ?? [];
    const lines: CanonicalOrderLine[] = items.length
        ? items.map((it, i) => ({
              platformLineId: String(it.order_item_code ?? it.item_no ?? `${orderId}-${i}`),
              platformProductId: it.product_no != null ? String(it.product_no) : null,
              platformVariantId: it.variant_code != null ? String(it.variant_code) : null,
              title: String(it.product_name ?? 'Item'),
              quantity: Number(it.quantity ?? 1) || 1,
              unitPrice: it.product_price != null ? Number(it.product_price) : null,
              status:
                  status === 'cancelled'
                      ? 'cancelled'
                      : status === 'refunded'
                        ? 'refunded'
                        : 'active',
          }))
        : [
              {
                  platformLineId: `${orderId}-unknown`,
                  platformProductId: null,
                  platformVariantId: null,
                  title: orderId,
                  quantity: 1,
                  unitPrice: null,
                  status: 'active' as const,
              },
          ];

    return {
        platformOrderId: orderId,
        status,
        orderedAt: String(resource.order_date ?? new Date().toISOString()),
        buyerName: resource.billing_name != null ? String(resource.billing_name) : null,
        currency: resource.currency != null ? String(resource.currency) : 'KRW',
        totalAmount: null,
        lines,
        raw: payload,
    };
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
        });
    }
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    const url = new URL(req.url);
    const platform = (url.searchParams.get('platform') ?? url.pathname.split('/').pop() ?? '') as Platform;
    if (platform !== 'shopify' && platform !== 'cafe24') {
        return jsonResponse({ error: 'platform must be shopify|cafe24' }, 400);
    }

    const rawBody = await req.text();
    const admin = serviceClient();

    try {
        if (platform === 'shopify') {
            const shop = (req.headers.get('X-Shopify-Shop-Domain') ?? '').toLowerCase();
            const hmac = req.headers.get('X-Shopify-Hmac-Sha256');
            if (!shop) return jsonResponse({ error: 'missing shop domain' }, 400);

            const { data: conn } = await admin
                .from('sales_channel_connections')
                .select('id, user_id, auto_fulfill_on_shipped, status')
                .eq('platform', 'shopify')
                .eq('shop_identifier', shop)
                .eq('status', 'active')
                .maybeSingle();

            if (!conn) {
                // Unknown shop — acknowledge to avoid retry storms
                return jsonResponse({ ok: true, skipped: 'unknown shop' });
            }

            const { data: secretRow } = await admin
                .from('sales_channel_secrets')
                .select('credentials')
                .eq('connection_id', conn.id)
                .single();

            const creds = (secretRow?.credentials ?? {}) as Record<string, string>;
            const secret =
                creds.webhook_secret ||
                creds.client_secret ||
                Deno.env.get('SHOPIFY_WEBHOOK_SECRET') ||
                '';

            if (secret && hmac) {
                const expected = await hmacSha256Base64(secret, rawBody);
                if (expected !== hmac) {
                    console.error('[order-webhook] shopify hmac mismatch', shop);
                    return jsonResponse({ error: 'invalid signature' }, 401);
                }
            }

            let payload: Record<string, unknown>;
            try {
                payload = JSON.parse(rawBody);
            } catch {
                return jsonResponse({ error: 'Invalid JSON' }, 400);
            }

            const order = parseShopifyOrder(payload);
            if (!order) return jsonResponse({ ok: true, skipped: 'unparseable' });

            const adapter = getAdapter('shopify');
            void adapter; // kept for future parseWebhook wiring

            await upsertCanonicalOrders(
                admin,
                {
                    userId: conn.user_id,
                    connectionId: conn.id,
                    platform: 'shopify',
                    autoFulfillOnShipped: conn.auto_fulfill_on_shipped === true,
                },
                [order],
            );

            await admin.from('order_sync_runs').insert({
                connection_id: conn.id,
                user_id: conn.user_id,
                trigger: 'webhook',
                status: 'success',
                finished_at: new Date().toISOString(),
                orders_upserted: 1,
            });

            return jsonResponse({ ok: true, upserted: 1 });
        }

        // cafe24
        let payload: Record<string, unknown>;
        try {
            payload = JSON.parse(rawBody);
        } catch {
            return jsonResponse({ error: 'Invalid JSON' }, 400);
        }

        const mallId = String(
            payload.mall_id ??
                (payload.resource as { mall_id?: string } | undefined)?.mall_id ??
                '',
        )
            .trim()
            .toLowerCase();
        if (!mallId) return jsonResponse({ ok: true, skipped: 'no mall_id' });

        const cafe24Secret = Deno.env.get('CAFE24_WEBHOOK_SECRET');
        if (cafe24Secret) {
            const hdr = req.headers.get('x-cafe24-webhook-secret') ?? req.headers.get('x-webhook-secret');
            if (hdr !== cafe24Secret) {
                return jsonResponse({ error: 'invalid signature' }, 401);
            }
        }

        const { data: conn } = await admin
            .from('sales_channel_connections')
            .select('id, user_id, auto_fulfill_on_shipped, status')
            .eq('platform', 'cafe24')
            .eq('shop_identifier', mallId)
            .eq('status', 'active')
            .maybeSingle();

        if (!conn) return jsonResponse({ ok: true, skipped: 'unknown mall' });

        const order = parseCafe24Order(payload);
        if (!order) return jsonResponse({ ok: true, skipped: 'unparseable' });

        await upsertCanonicalOrders(
            admin,
            {
                userId: conn.user_id,
                connectionId: conn.id,
                platform: 'cafe24',
                autoFulfillOnShipped: conn.auto_fulfill_on_shipped === true,
            },
            [order],
        );

        await admin.from('order_sync_runs').insert({
            connection_id: conn.id,
            user_id: conn.user_id,
            trigger: 'webhook',
            status: 'success',
            finished_at: new Date().toISOString(),
            orders_upserted: 1,
        });

        return jsonResponse({ ok: true, upserted: 1 });
    } catch (e) {
        console.error('[order-webhook]', platform, e);
        // Still 200 for platform retry control when we partially handled — use 500 only for hard failures
        return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
});
