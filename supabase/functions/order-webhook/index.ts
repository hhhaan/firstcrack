/**
 * POST /order-webhook?platform=shopify|cafe24|toss_place
 * Push ingest: fail-closed signature/secret verify, upsert canonical order.
 *
 * Shopify headers: X-Shopify-Shop-Domain, X-Shopify-Hmac-Sha256, X-Shopify-Topic
 * Cafe24: mall_id in payload; x-cafe24-webhook-secret / x-webhook-secret vs CAFE24_WEBHOOK_SECRET
 * Toss Place: x-toss-signature / x-toss-timestamp vs TOSS_PLACE_WEBHOOK_SECRET; merchantId in body
 */
import { corsHeaders, jsonResponse, serviceClient } from '../_shared/auth.ts';
import { getAdapter } from '../_shared/channels/adapters.ts';
import { upsertCanonicalOrders } from '../_shared/channels/normalize.ts';
import { cafe24ToCanonical, shopifyToCanonical } from '../_shared/channels/status-map.ts';
import { fetchTossPlaceOrderById, mapTossPlaceOrder, type TossPlaceOrderRaw } from '../_shared/channels/toss-place.ts';
import type { CanonicalOrder, CanonicalOrderLine, Platform } from '../_shared/channels/types.ts';
import { verifySharedSecret, verifyShopifyHmac, verifyTossPlaceSignature } from '../_shared/webhook-auth.ts';

function gidToId(gid: string): string {
    const parts = gid.split('/');
    return parts[parts.length - 1] ?? gid;
}

function parseShopifyOrder(payload: Record<string, unknown>): CanonicalOrder | null {
    const id =
        payload.id != null
            ? String(payload.id)
            : payload.admin_graphql_api_id
              ? gidToId(String(payload.admin_graphql_api_id))
              : '';
    if (!id) return null;

    const financial = payload.financial_status != null ? String(payload.financial_status) : null;
    const fulfillment = payload.fulfillment_status != null ? String(payload.fulfillment_status) : null;
    const cancelledAt = payload.cancelled_at != null ? String(payload.cancelled_at) : null;
    const status = shopifyToCanonical(financial, fulfillment, cancelledAt) ?? 'paid';

    const lineItems = (payload.line_items as Array<Record<string, unknown>> | undefined) ?? [];
    const lines: CanonicalOrderLine[] = lineItems.map((li, i) => {
        const lineStatus = status === 'cancelled' ? 'cancelled' : status === 'refunded' ? 'refunded' : 'active';
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
              status: status === 'cancelled' ? 'cancelled' : status === 'refunded' ? 'refunded' : 'active',
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
                ...corsHeaders,
                'Access-Control-Allow-Headers': `${corsHeaders['Access-Control-Allow-Headers']}, x-shopify-hmac-sha256, x-shopify-shop-domain, x-shopify-topic, x-cafe24-webhook-secret, x-webhook-secret, x-toss-signature, x-toss-timestamp, x-toss-webhook-id, x-toss-event-id`,
            },
        });
    }
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    const url = new URL(req.url);
    const platform = (url.searchParams.get('platform') ?? url.pathname.split('/').pop() ?? '') as Platform;
    if (platform !== 'shopify' && platform !== 'cafe24' && platform !== 'toss_place') {
        return jsonResponse({ error: 'platform must be shopify|cafe24|toss_place' }, 400);
    }

    const rawBody = await req.text();
    const admin = serviceClient();

    try {
        if (platform === 'toss_place') {
            const sig = req.headers.get('x-toss-signature');
            const ts = req.headers.get('x-toss-timestamp');
            if (!(await verifyTossPlaceSignature(Deno.env.get('TOSS_PLACE_WEBHOOK_SECRET'), rawBody, sig, ts))) {
                console.error('[order-webhook] toss_place signature reject');
                return jsonResponse({ error: 'Unauthorized' }, 401);
            }

            let payload: Record<string, unknown>;
            try {
                payload = JSON.parse(rawBody);
            } catch {
                return jsonResponse({ error: 'Invalid JSON' }, 400);
            }

            const eventType = String(payload.eventType ?? payload.type ?? payload.event ?? '');
            const data = (payload.data ?? payload.payload ?? payload) as Record<string, unknown>;
            const merchantId = String(data.merchantId ?? payload.merchantId ?? data.merchant_id ?? '').trim();
            if (!merchantId) return jsonResponse({ ok: true, skipped: 'no merchantId' });

            if (eventType === 'app.installation.deleted.v1') {
                await admin
                    .from('sales_channel_connections')
                    .update({
                        status: 'disabled',
                        last_error: 'app uninstalled',
                        updated_at: new Date().toISOString(),
                    })
                    .eq('platform', 'toss_place')
                    .eq('shop_identifier', merchantId)
                    .eq('status', 'active');
                return jsonResponse({ ok: true, disabled: true });
            }

            const { data: conn } = await admin
                .from('sales_channel_connections')
                .select('id, user_id, auto_fulfill_on_shipped, status')
                .eq('platform', 'toss_place')
                .eq('shop_identifier', merchantId)
                .eq('status', 'active')
                .maybeSingle();

            if (!conn) return jsonResponse({ ok: true, skipped: 'unknown merchant' });

            let orderRaw = (data.order ?? data) as TossPlaceOrderRaw;
            const orderId = String(data.orderId ?? orderRaw.id ?? '').trim();
            const thin =
                eventType.startsWith('payment.') ||
                (!orderRaw.orderState && !orderRaw.lineItems && !orderRaw.orderLineItems);

            if (thin && orderId) {
                try {
                    const full = await fetchTossPlaceOrderById(merchantId, orderId);
                    if (full) {
                        await upsertCanonicalOrders(
                            admin,
                            {
                                userId: conn.user_id,
                                connectionId: conn.id,
                                platform: 'toss_place',
                                autoFulfillOnShipped: conn.auto_fulfill_on_shipped === true,
                            },
                            [full],
                        );
                        await admin.from('order_sync_runs').insert({
                            connection_id: conn.id,
                            user_id: conn.user_id,
                            trigger: 'webhook',
                            status: 'success',
                            finished_at: new Date().toISOString(),
                            orders_upserted: 1,
                        });
                        return jsonResponse({ ok: true, upserted: 1, via: 'refetch' });
                    }
                } catch (e) {
                    console.error('[order-webhook] toss_place refetch', e);
                }
            }

            if (!orderRaw.orderState) {
                if (eventType.includes('cancelled') || eventType.includes('canceled')) {
                    orderRaw = { ...orderRaw, orderState: 'CANCELLED' };
                } else if (eventType.includes('completed') || eventType.includes('approved')) {
                    orderRaw = { ...orderRaw, orderState: 'COMPLETED' };
                }
            }
            if (orderRaw.id == null && orderId) {
                orderRaw = { ...orderRaw, id: orderId };
            }

            const order = mapTossPlaceOrder(orderRaw);
            if (!order) return jsonResponse({ ok: true, skipped: 'unparseable' });

            await upsertCanonicalOrders(
                admin,
                {
                    userId: conn.user_id,
                    connectionId: conn.id,
                    platform: 'toss_place',
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
            const secret = creds.webhook_secret || creds.client_secret || Deno.env.get('SHOPIFY_WEBHOOK_SECRET') || '';

            // fail-closed: secret 또는 헤더 부재 = 검증 불가 = 거부 (기존: 조용히 통과)
            if (!(await verifyShopifyHmac(secret, rawBody, hmac))) {
                console.error('[order-webhook] shopify hmac reject', shop);
                return jsonResponse({ error: 'Unauthorized' }, 401);
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

        const mallId = String(payload.mall_id ?? (payload.resource as { mall_id?: string } | undefined)?.mall_id ?? '')
            .trim()
            .toLowerCase();
        if (!mallId) return jsonResponse({ ok: true, skipped: 'no mall_id' });

        // fail-closed: env 미설정 포함 전부 거부 (기존: env 없으면 무검증 통과)
        const cafe24Header = req.headers.get('x-cafe24-webhook-secret') ?? req.headers.get('x-webhook-secret');
        if (!verifySharedSecret(Deno.env.get('CAFE24_WEBHOOK_SECRET'), cafe24Header)) {
            console.error('[order-webhook] cafe24 secret reject', mallId);
            return jsonResponse({ error: 'Unauthorized' }, 401);
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
