/**
 * Toss Place POS Open API — pull-only ERP connector (#84 / ORD3).
 *
 * Auth: product-wide Access Key + Secret Key (function env), per-merchant install.
 *   https://docs.tossplace.com/reference/open-api/common.html
 * Orders (payment-change window, default COMPLETED+CANCELLED):
 *   https://docs.tossplace.com/reference/open-api/order/order-methods.html
 * Not Toss Payments PG. Outbound ship is not supported.
 */

import { lineQuantity, lineStatusOf } from './normalize.ts';
import { nextPollCursor } from './poll-cursor.ts';
import { readHttpAttempt, tossPlaceThrottle, withRetry } from './rate-limit.ts';
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

const BASE = 'https://open-api.tossplace.com/api-public/openapi/v1';
const PAGE_SIZE = 100;
const MAX_ORDER_PAGES = 5;
const MAX_CATALOG_PAGES = 5;
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const OVERLAP_MS = 2 * 60 * 1000;

export interface TossPlaceSecrets extends ChannelSecrets {
    merchant_id: string;
}

type TossEnvelope<T> = {
    resultType?: string;
    success?: T;
    error?: { errorCode?: string; reason?: string };
};

export type TossPlaceOrderLineItem = {
    item?: { title?: string; code?: string | null };
    itemPrice?: { priceValue?: number };
    quantity?: number;
};

export type TossPlaceOrder = {
    id?: string | number;
    merchantId?: number;
    orderState?: string;
    createdAt?: string;
    completedAt?: string | null;
    cancelledAt?: string | null;
    chargePrice?: { totalAmount?: number };
    lineItems?: TossPlaceOrderLineItem[];
};

export type TossPlaceMerchant = {
    id?: number | string;
    name?: string;
    displayName?: string;
};

export type TossPlaceCatalogItem = {
    id?: string | number;
    title?: string;
    code?: string | null;
};

function readEnv(name: string): string {
    try {
        const deno = (globalThis as { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno;
        return (deno?.env.get(name) ?? '').trim();
    } catch {
        return '';
    }
}

function appKeys(secrets: ChannelSecrets): { accessKey: string; secretKey: string } {
    const accessKey = readEnv('TOSS_PLACE_ACCESS_KEY') || String(secrets.access_key ?? '').trim();
    const secretKey = readEnv('TOSS_PLACE_SECRET_KEY') || String(secrets.secret_key ?? '').trim();
    if (!accessKey || !secretKey) {
        throw new Error('toss_place: TOSS_PLACE_ACCESS_KEY and TOSS_PLACE_SECRET_KEY required');
    }
    return { accessKey, secretKey };
}

export function requireTossPlaceMerchantId(raw: unknown): string {
    const id = String(raw ?? '').trim();
    if (!/^\d+$/.test(id)) throw new Error('toss_place: merchant_id required (numeric)');
    return id;
}

function requireTossPlace(secrets: ChannelSecrets): TossPlaceSecrets {
    return { ...secrets, merchant_id: requireTossPlaceMerchantId(secrets.merchant_id) };
}

function buildUrl(path: string, query?: Record<string, string | string[] | undefined>): string {
    const url = new URL(`${BASE}${path}`);
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value == null) continue;
            if (Array.isArray(value)) {
                for (const item of value) url.searchParams.append(key, item);
            } else {
                url.searchParams.set(key, value);
            }
        }
    }
    return url.toString();
}

async function tossGet<T>(
    path: string,
    secrets: ChannelSecrets,
    query?: Record<string, string | string[] | undefined>,
): Promise<T> {
    const { accessKey, secretKey } = appKeys(secrets);
    const res = await withRetry(
        () =>
            fetch(buildUrl(path, query), {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'x-access-key': accessKey,
                    'x-secret-key': secretKey,
                },
            }).then(readHttpAttempt),
        tossPlaceThrottle,
        { label: 'toss_place' },
    );
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`toss_place ${res.status}: ${res.body.slice(0, 300)}`);
    }
    let json: TossEnvelope<T>;
    try {
        json = JSON.parse(res.body) as TossEnvelope<T>;
    } catch {
        throw new Error(`toss_place: invalid JSON (${res.body.slice(0, 120)})`);
    }
    if (json.resultType !== 'SUCCESS' || json.success === undefined) {
        const reason = json.error?.reason ?? json.resultType ?? 'empty success';
        throw new Error(`toss_place: ${reason}`);
    }
    return json.success;
}

export function mapTossPlaceOrder(order: TossPlaceOrder): CanonicalOrder | null {
    const status = tossPlaceToCanonical(order.orderState);
    if (!status) return null;
    const platformOrderId = String(order.id ?? '').trim();
    if (!platformOrderId) return null;

    const lines: CanonicalOrderLine[] = (order.lineItems ?? []).map((line, index) => {
        const code = String(line.item?.code ?? '').trim();
        return {
            platformLineId: `${platformOrderId}:${index}`,
            platformProductId: code || null,
            platformVariantId: null,
            sku: code || null,
            title: line.item?.title || 'Item',
            quantity: lineQuantity(line.quantity),
            unitPrice: line.itemPrice?.priceValue != null ? Number(line.itemPrice.priceValue) : null,
            status: lineStatusOf(status),
        };
    });

    const orderedAt = order.completedAt || order.createdAt;
    if (!orderedAt) return null;

    return {
        platformOrderId,
        status,
        orderedAt,
        buyerName: null,
        currency: 'KRW',
        totalAmount: order.chargePrice?.totalAmount != null ? Number(order.chargePrice.totalAmount) : null,
        lines,
        raw: order,
    };
}

/** CANCELLED wins when the same id appears in both the main window and the trailing rescan. */
export function mergeTossPlaceOrders(main: CanonicalOrder[], cancelled: CanonicalOrder[]): CanonicalOrder[] {
    const byId = new Map<string, CanonicalOrder>();
    for (const order of main) byId.set(order.platformOrderId, order);
    for (const order of cancelled) {
        const existing = byId.get(order.platformOrderId);
        if (!existing || order.status === 'cancelled') byId.set(order.platformOrderId, order);
    }
    return [...byId.values()];
}

async function fetchOrderPages(
    secrets: TossPlaceSecrets,
    from: string,
    to: string,
    orderStates: string[],
): Promise<{ orders: CanonicalOrder[]; complete: boolean }> {
    const orders: CanonicalOrder[] = [];
    let page = 1;
    let complete = true;

    for (; page <= MAX_ORDER_PAGES; page++) {
        const payload = await tossGet<TossPlaceOrder[]>(
            `/merchants/${secrets.merchant_id}/order/orders`,
            secrets,
            { from, to, orderStates, page: String(page), size: String(PAGE_SIZE), sortOrder: 'ASC' },
        );
        const rows = Array.isArray(payload) ? payload : [];
        for (const row of rows) {
            const mapped = mapTossPlaceOrder(row);
            if (mapped) orders.push(mapped);
        }
        if (rows.length < PAGE_SIZE) return { orders, complete: true };
        if (page === MAX_ORDER_PAGES) complete = false;
    }
    return { orders, complete };
}

export const tossPlaceAdapter: ChannelAdapter = {
    platform: 'toss_place',
    capabilities: { webhooks: true, outboundDispatch: false },

    async testConnection(secrets): Promise<TestConnectionResult> {
        const s = requireTossPlace(secrets);
        const merchant = await tossGet<TossPlaceMerchant>(`/merchants/${s.merchant_id}`, s);
        const shopIdentifier = String(merchant.id ?? s.merchant_id);
        return {
            shopIdentifier,
            displayName: merchant.displayName || merchant.name || shopIdentifier,
        };
    },

    async refreshAuth(): Promise<ChannelSecrets | null> {
        return null;
    },

    async fetchOrdersSince(secrets, cursor: PollCursor): Promise<FetchOrdersResult> {
        const s = requireTossPlace(secrets);
        const nowMs = Date.now();
        const from = cursor.since ?? new Date(nowMs - LOOKBACK_MS).toISOString();
        const to = new Date(nowMs).toISOString();
        const cancelFrom = new Date(nowMs - LOOKBACK_MS).toISOString();

        const main = await fetchOrderPages(s, from, to, ['COMPLETED', 'CANCELLED']);
        const trailing = await fetchOrderPages(s, cancelFrom, to, ['CANCELLED']);
        const orders = mergeTossPlaceOrders(main.orders, trailing.orders);

        const windowEndMs = Math.max(Date.parse(from) || 0, nowMs - OVERLAP_MS);
        return {
            orders,
            nextCursor: nextPollCursor({
                complete: main.complete,
                windowEnd: new Date(windowEndMs).toISOString(),
                resumeFrom: from,
            }),
        };
    },

    async listProducts(secrets): Promise<PlatformListing[]> {
        const s = requireTossPlace(secrets);
        const out: PlatformListing[] = [];
        for (let page = 1; page <= MAX_CATALOG_PAGES; page++) {
            const payload = await tossGet<TossPlaceCatalogItem[]>(
                `/merchants/${s.merchant_id}/catalog/items`,
                s,
                { page: String(page), size: String(PAGE_SIZE) },
            );
            const rows = Array.isArray(payload) ? payload : [];
            for (const item of rows) {
                const id = String(item.id ?? '').trim();
                const code = String(item.code ?? '').trim();
                if (!id && !code) continue;
                out.push({
                    platformProductId: code || id,
                    platformVariantId: null,
                    title: item.title || code || id,
                    sku: code || null,
                });
            }
            if (rows.length < PAGE_SIZE) break;
        }
        return out;
    },

    async markShipped(_secrets: ChannelSecrets, _req: MarkShippedRequest): Promise<MarkShippedResult> {
        return { ok: false, alreadyShipped: false, error: 'not supported' };
    },
};
