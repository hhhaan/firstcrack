/**
 * Toss Place Open API — offline POS order pull (ERP path).
 *
 * Auth: x-access-key / x-secret-key (partner app keys from function env).
 * Docs: https://docs.tossplace.com/reference/open-api/intro.html
 *
 * Platform id: toss_place (not Toss Payments PG).
 * outboundDispatch: false — walk-in POS, no marketplace ship.
 */

import { tossPlaceToCanonical } from './status-map.ts';
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

const BASE = 'https://open-api.tossplace.com/api-public/openapi/v1/merchants';
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 20;
const OVERLAP_MS = 2 * 60 * 1000;
const TRAILING_CANCEL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TossPlaceSecrets extends ChannelSecrets {
    merchant_id: string;
}

export function getTossPlaceAppKeys(): { accessKey: string; secretKey: string } {
    const accessKey = (Deno.env.get('TOSS_PLACE_ACCESS_KEY') ?? '').trim();
    const secretKey = (Deno.env.get('TOSS_PLACE_SECRET_KEY') ?? '').trim();
    if (!accessKey || !secretKey) {
        throw new Error('toss_place: TOSS_PLACE_ACCESS_KEY and TOSS_PLACE_SECRET_KEY env required');
    }
    return { accessKey, secretKey };
}

function requireTossPlace(secrets: ChannelSecrets): TossPlaceSecrets {
    const merchant_id = String(secrets.merchant_id ?? secrets.merchantId ?? '').trim();
    if (!merchant_id) throw new Error('toss_place: merchant_id required');
    return { ...secrets, merchant_id };
}

type TossEnvelope<T> = {
    resultType?: string;
    success?: T;
    error?: { errorCode?: string; reason?: string; message?: string };
};

async function tossFetch<T>(
    merchantId: string,
    path: string,
    query?: Record<string, string | undefined>,
    keys?: { accessKey: string; secretKey: string },
): Promise<T> {
    const { accessKey, secretKey } = keys ?? getTossPlaceAppKeys();
    const url = new URL(`${BASE}/${encodeURIComponent(merchantId)}${path}`);
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v != null && v !== '') url.searchParams.set(k, v);
        }
    }

    let attempt = 0;
    while (true) {
        const res = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-access-key': accessKey,
                'x-secret-key': secretKey,
            },
        });

        if (res.status === 429) {
            attempt += 1;
            if (attempt > 4) throw new Error('toss_place: rate limited (429)');
            const reset = res.headers.get('x-ratelimit-reset');
            const resetMs = reset ? Number(reset) : NaN;
            const wait = Number.isFinite(resetMs)
                ? Math.max(200, Math.min(resetMs - Date.now(), 5_000))
                : 500 * attempt;
            await new Promise((r) => setTimeout(r, wait));
            continue;
        }

        const text = await res.text();
        if (!res.ok) {
            throw new Error(`toss_place ${res.status}: ${text.slice(0, 300)}`);
        }

        let json: TossEnvelope<T>;
        try {
            json = JSON.parse(text) as TossEnvelope<T>;
        } catch {
            throw new Error('toss_place: invalid JSON envelope');
        }

        if ((json.resultType ?? '').toUpperCase() === 'FAIL' || json.error) {
            const code = json.error?.errorCode ?? 'FAIL';
            const reason = json.error?.reason ?? json.error?.message ?? '';
            throw new Error(`toss_place API ${code}: ${reason}`.slice(0, 300));
        }
        if (json.success === undefined) throw new Error('toss_place: empty success payload');
        return json.success;
    }
}

// ── Order mapping (exported for unit tests) ─────────────────────────────────

export type TossPlaceOrderRaw = {
    id?: string | number;
    orderKey?: string;
    orderNumber?: string;
    orderState?: string;
    createdAt?: string;
    completedAt?: string | null;
    cancelledAt?: string | null;
    chargePrice?: {
        totalAmount?: number;
        taxAmount?: number;
        supplyAmount?: number;
        taxExemptAmount?: number;
    };
    lineItems?: TossPlaceLineRaw[];
    orderLineItems?: TossPlaceLineRaw[];
    payments?: unknown[];
    source?: string;
    merchantId?: string | number;
    [key: string]: unknown;
};

export type TossPlaceLineRaw = {
    id?: string | number;
    quantity?: number;
    item?: {
        id?: string | number;
        title?: string;
        name?: string;
        code?: string | null;
    };
    itemPrice?: {
        priceValue?: number;
        isTaxFree?: boolean;
    };
    [key: string]: unknown;
};

export function mapTossPlaceOrder(order: TossPlaceOrderRaw): CanonicalOrder | null {
    const id = order.id != null ? String(order.id) : '';
    if (!id) return null;

    const status = tossPlaceToCanonical(order.orderState) ?? 'paid';
    const lineSrc = order.lineItems ?? order.orderLineItems ?? [];
    const lines: CanonicalOrderLine[] = lineSrc.map((li, i) => {
        const code = li.item?.code != null && String(li.item.code).trim() ? String(li.item.code).trim() : null;
        const lineStatus = status === 'cancelled' ? 'cancelled' : status === 'refunded' ? 'refunded' : 'active';
        return {
            platformLineId: li.id != null ? String(li.id) : `${id}:${i}`,
            platformProductId: code,
            platformVariantId: null,
            title: String(li.item?.title ?? li.item?.name ?? 'Item'),
            quantity: Number(li.quantity ?? 1) || 1,
            unitPrice: li.itemPrice?.priceValue != null ? Number(li.itemPrice.priceValue) : null,
            status: lineStatus as CanonicalOrderLine['status'],
        };
    });

    const orderedAt = String(order.completedAt || order.createdAt || order.cancelledAt || new Date().toISOString());

    return {
        platformOrderId: id,
        status,
        orderedAt,
        buyerName: null,
        currency: 'KRW',
        totalAmount: order.chargePrice?.totalAmount != null ? Number(order.chargePrice.totalAmount) : null,
        lines,
        raw: order,
    };
}

function extractOrderList(payload: unknown): TossPlaceOrderRaw[] {
    if (Array.isArray(payload)) return payload as TossPlaceOrderRaw[];
    if (!payload || typeof payload !== 'object') return [];
    const o = payload as Record<string, unknown>;
    for (const key of ['content', 'orders', 'items', 'list', 'data']) {
        if (Array.isArray(o[key])) return o[key] as TossPlaceOrderRaw[];
    }
    return [];
}

function merchantDisplayName(payload: Record<string, unknown>, merchantId: string): string {
    for (const key of ['name', 'displayName', 'businessName', 'storeName', 'merchantName']) {
        const v = payload[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return `Toss Place ${merchantId}`;
}

function catalogItems(payload: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
    if (!payload || typeof payload !== 'object') return [];
    const o = payload as Record<string, unknown>;
    for (const key of ['content', 'items', 'list', 'data']) {
        if (Array.isArray(o[key])) return o[key] as Array<Record<string, unknown>>;
    }
    return [];
}

async function fetchOrdersWindow(
    merchantId: string,
    from: string,
    to: string,
    orderStates: string,
): Promise<CanonicalOrder[]> {
    const out: CanonicalOrder[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
        const payload = await tossFetch<unknown>(merchantId, '/order/orders', {
            from,
            to,
            orderStates,
            page: String(page),
            size: String(DEFAULT_PAGE_SIZE),
            sortOrder: 'ASC',
        });
        const rows = extractOrderList(payload);
        if (!rows.length) break;
        for (const row of rows) {
            const mapped = mapTossPlaceOrder(row);
            if (!mapped || seen.has(mapped.platformOrderId)) continue;
            seen.add(mapped.platformOrderId);
            out.push(mapped);
        }
        if (rows.length < DEFAULT_PAGE_SIZE) break;
    }
    return out;
}

/** Fetch single order by id (webhook fill-in). */
export async function fetchTossPlaceOrderById(merchantId: string, orderId: string): Promise<CanonicalOrder | null> {
    const payload = await tossFetch<TossPlaceOrderRaw>(merchantId, `/order/orders/${encodeURIComponent(orderId)}`);
    return mapTossPlaceOrder(payload);
}

export const tossPlaceAdapter: ChannelAdapter = {
    platform: 'toss_place',
    capabilities: { webhooks: true, outboundDispatch: false },

    async testConnection(secrets: ChannelSecrets): Promise<TestConnectionResult> {
        const s = requireTossPlace(secrets);
        const merchant = await tossFetch<Record<string, unknown>>(s.merchant_id, '');
        return {
            shopIdentifier: s.merchant_id,
            displayName: merchantDisplayName(merchant, s.merchant_id),
        };
    },

    async refreshAuth(_secrets: ChannelSecrets): Promise<ChannelSecrets | null> {
        return null; // static partner app keys in env
    },

    async fetchOrdersSince(secrets: ChannelSecrets, cursor: PollCursor): Promise<FetchOrdersResult> {
        const s = requireTossPlace(secrets);
        const now = Date.now();
        const defaultFrom = new Date(now - TRAILING_CANCEL_MS).toISOString();
        const sinceIso = cursor.since ?? defaultFrom;
        const sinceMs = Date.parse(sinceIso);
        const fromMs = (Number.isFinite(sinceMs) ? sinceMs : now - TRAILING_CANCEL_MS) - OVERLAP_MS;
        const from = new Date(Math.max(0, fromMs)).toISOString();
        const to = new Date(now).toISOString();

        const primary = await fetchOrdersWindow(s.merchant_id, from, to, 'COMPLETED,CANCELLED');

        // Late-cancellation rescan: CANCELLED-only over trailing 7d (poll-only until webhooks)
        const cancelFrom = new Date(now - TRAILING_CANCEL_MS).toISOString();
        const cancellations = await fetchOrdersWindow(s.merchant_id, cancelFrom, to, 'CANCELLED');

        const byId = new Map<string, CanonicalOrder>();
        for (const o of primary) byId.set(o.platformOrderId, o);
        for (const o of cancellations) byId.set(o.platformOrderId, o); // CANCELLED wins if re-fetched

        return {
            orders: [...byId.values()],
            nextCursor: { since: to },
        };
    },

    async listProducts(secrets: ChannelSecrets): Promise<PlatformListing[]> {
        const s = requireTossPlace(secrets);
        const out: PlatformListing[] = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
            const payload = await tossFetch<unknown>(s.merchant_id, '/catalog/items', {
                page: String(page),
                size: String(DEFAULT_PAGE_SIZE),
            });
            const items = catalogItems(payload);
            if (!items.length) break;
            for (const it of items) {
                const code = it.code != null ? String(it.code).trim() : '';
                const id = it.id != null ? String(it.id) : code || '';
                if (!id && !code) continue;
                out.push({
                    platformProductId: id || code,
                    platformVariantId: null,
                    title: String(it.title ?? it.name ?? (code || id)),
                    sku: code || null,
                });
            }
            if (items.length < DEFAULT_PAGE_SIZE) break;
        }
        return out;
    },

    async markShipped(_secrets: ChannelSecrets, _req: MarkShippedRequest): Promise<MarkShippedResult> {
        return { ok: false, alreadyShipped: false, error: 'not supported' };
    },
};
