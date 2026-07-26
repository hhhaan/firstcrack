/**
 * Cafe24 Admin API — official docs only.
 *
 * Base / auth:
 *   https://developers.cafe24.com/docs/en/api/
 *   URL: https://{mallid}.cafe24api.com/api/v2/admin/...
 *   Admin API requires OAuth 2.0 access token (Bearer).
 *   Scope for orders: mall.read_order
 *
 * Orders list:
 *   GET /api/v2/admin/orders
 *   Params (official Request table): start_date + end_date (together),
 *     date_type (order_date | pay_date | …), order_status, embed=items,buyer,
 *     limit, offset, shop_no
 *
 * Orders fields (Orders property list):
 *   order_id, currency, billing_name, paid (T|F|M), canceled (T|F|M),
 *   order_date, payment_date, shipping_status (F|M|T|W|X), process_status,
 *   items (embed), actual_order_amount, …
 *
 * Store:
 *   GET /api/v2/admin/store — Retrieve store details
 *
 * OAuth refresh:
 *   https://developers.cafe24.com/docs/en/api/  (Get Access Token using refresh token)
 *   POST https://{mallid}.cafe24api.com/api/v2/oauth/token
 */

import { buildCafe24ShipmentPayload } from './dispatch.ts';
import { cafe24ToCanonical } from './status-map.ts';
import type {
    CanonicalOrder,
    CanonicalOrderLine,
    ChannelAdapter,
    ChannelSecrets,
    FetchOrdersResult,
    MarkShippedRequest,
    MarkShippedResult,
    PlatformListing,
    PollCursor,
    TestConnectionResult,
} from './types.ts';

export interface Cafe24Secrets extends ChannelSecrets {
    mall_id: string;
    access_token: string;
    refresh_token?: string;
    client_id?: string;
    client_secret?: string;
    token_expires_at?: number;
    shop_no?: string | number;
}

function requireCafe24(secrets: ChannelSecrets): Cafe24Secrets {
    const mall_id = String(secrets.mall_id ?? '')
        .trim()
        .toLowerCase();
    const access_token = String(secrets.access_token ?? '').trim();
    if (!mall_id || !access_token) throw new Error('cafe24: mall_id and access_token required');
    return {
        ...secrets,
        mall_id,
        access_token,
        refresh_token: secrets.refresh_token ? String(secrets.refresh_token) : undefined,
        client_id: secrets.client_id ? String(secrets.client_id) : undefined,
        client_secret: secrets.client_secret ? String(secrets.client_secret) : undefined,
        token_expires_at: secrets.token_expires_at ? Number(secrets.token_expires_at) : undefined,
        shop_no: secrets.shop_no as string | number | undefined,
    };
}

function adminBase(mallId: string): string {
    return `https://${mallId}.cafe24api.com/api/v2/admin`;
}

async function cafe24Get(
    mallId: string,
    token: string,
    path: string,
    query?: Record<string, string>,
): Promise<unknown> {
    const url = new URL(`${adminBase(mallId)}${path}`);
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v) url.searchParams.set(k, v);
        }
    }
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
    });
    if (!res.ok) {
        throw new Error(`cafe24 ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return res.json();
}

/** App credentials from env (production OAuth app). Falls back to secrets for legacy paste tokens. */
function resolveCafe24Client(secrets: Cafe24Secrets): { clientId: string; clientSecret: string } | null {
    const envId = (Deno.env.get('CAFE24_CLIENT_ID') ?? '').trim();
    const envSecret = (Deno.env.get('CAFE24_CLIENT_SECRET') ?? '').trim();
    if (envId && envSecret) return { clientId: envId, clientSecret: envSecret };
    if (secrets.client_id && secrets.client_secret) {
        return { clientId: String(secrets.client_id), clientSecret: String(secrets.client_secret) };
    }
    return null;
}

export async function refreshCafe24Token(secrets: Cafe24Secrets): Promise<Cafe24Secrets | null> {
    if (!secrets.refresh_token) return null;
    const client = resolveCafe24Client(secrets);
    if (!client) return null;

    const skew = 5 * 60 * 1000;
    if (secrets.token_expires_at && secrets.token_expires_at - skew > Date.now()) return null;

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: secrets.refresh_token,
    });
    const basic = btoa(`${client.clientId}:${client.clientSecret}`);
    const res = await fetch(`https://${secrets.mall_id}.cafe24api.com/api/v2/oauth/token`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
    if (!res.ok) {
        throw new Error(`cafe24 refresh ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_at?: string;
        expires_in?: number;
    };
    // Official: new refresh_token revokes the previous one — always persist rotation.
    return {
        ...secrets,
        access_token: json.access_token,
        refresh_token: json.refresh_token ?? secrets.refresh_token,
        token_expires_at: json.expires_in
            ? Date.now() + json.expires_in * 1000
            : json.expires_at
              ? Date.parse(json.expires_at)
              : undefined,
    };
}

function amountOf(order: Record<string, unknown>): number | null {
    const actual = order.actual_order_amount;
    if (actual && typeof actual === 'object') {
        const v = (actual as { order_price_amount?: string | number }).order_price_amount;
        if (v != null) return Number(v);
    }
    if (order.order_price_amount != null) return Number(order.order_price_amount);
    if (order.payment_amount != null) return Number(order.payment_amount);
    return null;
}

function mapItems(order: Record<string, unknown>, orderStatus: string): CanonicalOrderLine[] {
    const items = (order.items ?? []) as Array<Record<string, unknown>>;
    const lineStatus =
        orderStatus === 'cancelled' ? 'cancelled' : orderStatus === 'refunded' ? 'refunded' : 'active';

    return items.map((it, i) => ({
        platformLineId: String(it.order_item_code ?? it.item_no ?? `${order.order_id}-${i}`),
        platformProductId: it.product_no != null ? String(it.product_no) : null,
        platformVariantId: it.variant_code != null
            ? String(it.variant_code)
            : it.option_id != null
              ? String(it.option_id)
              : null,
        title: String(it.product_name ?? it.product_name_default ?? 'Item'),
        quantity: Number(it.quantity ?? 1) || 1,
        unitPrice: it.product_price != null
            ? Number(it.product_price)
            : it.price != null
              ? Number(it.price)
              : null,
        status: lineStatus as CanonicalOrderLine['status'],
    }));
}

function mapCafe24Order(order: Record<string, unknown>): CanonicalOrder | null {
    const orderId = String(order.order_id ?? '');
    if (!orderId) return null;

    const status =
        cafe24ToCanonical({
            paid: order.paid != null ? String(order.paid) : null,
            canceled: order.canceled != null ? String(order.canceled) : null,
            shippingStatus: order.shipping_status != null ? String(order.shipping_status) : null,
            processStatus: order.process_status != null ? String(order.process_status) : null,
            orderStatus: order.order_status != null ? String(order.order_status) : null,
        }) ?? 'paid';

    let lines = mapItems(order, status);
    if (!lines.length) {
        lines = [
            {
                platformLineId: `${orderId}-unknown`,
                platformProductId: null,
                platformVariantId: null,
                title: orderId,
                quantity: 1,
                unitPrice: amountOf(order),
                status: 'active',
            },
        ];
    }

    const buyer =
        (order.billing_name as string) ??
        (order.buyer as { name?: string } | undefined)?.name ??
        (order.orderer_name as string) ??
        null;

    return {
        platformOrderId: orderId,
        status,
        orderedAt: String(order.order_date ?? order.payment_date ?? new Date().toISOString()),
        buyerName: buyer,
        currency: order.currency != null ? String(order.currency) : 'KRW',
        totalAmount: amountOf(order),
        lines,
        raw: order,
    };
}

export const cafe24Adapter: ChannelAdapter = {
    platform: 'cafe24',
    capabilities: { webhooks: true, outboundDispatch: true },

    async testConnection(secrets): Promise<TestConnectionResult> {
        const s = requireCafe24(secrets);
        const data = (await cafe24Get(s.mall_id, s.access_token, '/store')) as {
            store?: { shop_name?: string; mall_id?: string; mall_url?: string };
        };
        const store = data.store ?? {};
        return {
            shopIdentifier: String(store.mall_id ?? s.mall_id),
            displayName: String(store.shop_name ?? store.mall_url ?? s.mall_id),
        };
    },

    async refreshAuth(secrets): Promise<ChannelSecrets | null> {
        return refreshCafe24Token(requireCafe24(secrets));
    },

    async fetchOrdersSince(secrets, cursor): Promise<FetchOrdersResult> {
        let s = requireCafe24(secrets);
        const refreshed = await refreshCafe24Token(s);
        if (refreshed) s = refreshed;

        // Official: start_date + end_date required together; date_type default order_date
        const end = new Date();
        const start = cursor.since ? new Date(cursor.since) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const startDate = start.toISOString().slice(0, 10);
        const endDate = end.toISOString().slice(0, 10);
        const limit = 100;
        const maxPages = 50;
        const rawOrders: Array<Record<string, unknown>> = [];
        let offset = 0;
        let pages = 0;
        let complete = true;

        while (pages < maxPages) {
            const query: Record<string, string> = {
                start_date: startDate,
                end_date: endDate,
                date_type: 'order_date',
                embed: 'items,buyer',
                limit: String(limit),
                offset: String(offset),
            };
            if (s.shop_no != null) query.shop_no = String(s.shop_no);

            const data = (await cafe24Get(s.mall_id, s.access_token, '/orders', query)) as {
                orders?: Array<Record<string, unknown>>;
            };
            const batch = data.orders ?? [];
            rawOrders.push(...batch);
            pages += 1;
            if (batch.length < limit) break;
            offset += limit;
            if (pages >= maxPages) {
                complete = false;
                break;
            }
        }

        const orders = rawOrders.map(mapCafe24Order).filter((o): o is CanonicalOrder => o != null);

        // Detail fill when list omitted items
        for (let i = 0; i < orders.length; i++) {
            if (orders[i].lines.length === 1 && orders[i].lines[0].platformLineId.endsWith('-unknown')) {
                try {
                    const detail = (await cafe24Get(
                        s.mall_id,
                        s.access_token,
                        `/orders/${orders[i].platformOrderId}`,
                        { embed: 'items,buyer' },
                    )) as { order?: Record<string, unknown> };
                    if (detail.order) {
                        const mapped = mapCafe24Order(detail.order);
                        if (mapped) orders[i] = mapped;
                    }
                } catch {
                    // keep placeholder
                }
            }
        }

        // Do not advance watermark past unread pages (avoids permanent order loss).
        return {
            orders,
            nextCursor: {
                since: complete ? end.toISOString() : (cursor.since ?? start.toISOString()),
            },
        };
    },

    async listProducts(secrets): Promise<PlatformListing[]> {
        let s = requireCafe24(secrets);
        const refreshed = await refreshCafe24Token(s);
        if (refreshed) s = refreshed;

        const data = (await cafe24Get(s.mall_id, s.access_token, '/products', {
            limit: '50',
        })) as {
            products?: Array<{
                product_no: number | string;
                product_name?: string;
                product_code?: string;
                variants?: Array<{ variant_code?: string; custom_variant_code?: string; options?: unknown }>;
            }>;
        };

        const out: PlatformListing[] = [];
        for (const p of data.products ?? []) {
            const variants = p.variants ?? [];
            if (!variants.length) {
                out.push({
                    platformProductId: String(p.product_no),
                    platformVariantId: null,
                    title: String(p.product_name ?? p.product_no),
                    sku: p.product_code != null ? String(p.product_code) : null,
                });
                continue;
            }
            for (const v of variants) {
                out.push({
                    platformProductId: String(p.product_no),
                    platformVariantId: v.variant_code != null ? String(v.variant_code) : null,
                    title: String(p.product_name ?? p.product_no),
                    sku: v.custom_variant_code ?? p.product_code ?? null,
                });
            }
        }
        return out;
    },

    async markShipped(secrets, req: MarkShippedRequest): Promise<MarkShippedResult> {
        let s = requireCafe24(secrets);
        const refreshed = await refreshCafe24Token(s);
        if (refreshed) s = refreshed;

        const payload = buildCafe24ShipmentPayload(req);
        const url = `${adminBase(s.mall_id)}/orders/${encodeURIComponent(req.platformOrderId)}/shipments`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${s.access_token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(payload),
        });
        const text = await res.text();
        if (!res.ok) {
            // 오탐 시 fulfill_order까지 진행되어 재고가 차감된다 → 명시적 "이미 처리됨"만 성공 취급
            const already = /already|이미/i.test(text);
            if (already || res.status === 409) {
                return { ok: true, alreadyShipped: true, error: text.slice(0, 300) };
            }
            return {
                ok: false,
                alreadyShipped: false,
                error: `cafe24 shipments ${res.status}: ${text.slice(0, 300)}`,
            };
        }
        return {
            ok: true,
            alreadyShipped: false,
            lineResults: req.lines.map((l) => ({ platformLineId: l.platformLineId, ok: true })),
        };
    },
};
