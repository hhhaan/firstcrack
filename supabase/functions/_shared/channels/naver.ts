/**
 * Naver Commerce API (Smart Store) — official docs only.
 *
 * Auth:
 *   https://apicenter.commerce.naver.com/docs/auth
 *   https://apicenter.commerce.naver.com/docs/commerce-api/current/exchange-sellers-auth
 *   Token URL: https://api.commerce.naver.com/external/v1/oauth2/token
 *   Signature: Base64(bcrypt.hashpw(clientId_timestamp, clientSecret))
 *   Body (form): client_id, timestamp, client_secret_sign, grant_type=client_credentials, type=SELF
 *   Token TTL: 3h (10800s); re-issue when <30m remaining
 *
 * Orders:
 *   GET  /v1/pay-order/seller/product-orders/last-changed-statuses
 *     https://apicenter.commerce.naver.com/docs/commerce-api/current/seller-get-last-changed-status-pay-order-seller
 *     Window max 24h if lastChangedTo omitted; page via more.moreFrom + more.moreSequence; max 300/page
 *   POST /v1/pay-order/seller/product-orders/query
 *     https://apicenter.commerce.naver.com/docs/commerce-api/current/seller-get-product-orders-pay-order-seller
 *     Body: productOrderIds[] max 300
 *
 * Schemas:
 *   https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/변경-상품-주문-정보-구조체
 *   https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/상품-주문-정보-구조체
 */

import { hash as bcryptHash } from 'npm:bcryptjs@2.4.3';
import {
    buildNaverDispatchPayload,
    type NaverDispatchResponse,
    readNaverDispatchResult,
} from './dispatch.ts';
import { nextPollCursor } from './poll-cursor.ts';
import { naverToCanonical } from './status-map.ts';
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
    SecretsRotationSink,
    TestConnectionResult,
} from './types.ts';

const BASE = 'https://api.commerce.naver.com/external';

/**
 * last-changed pages walked per 24h window before the scan is declared incomplete.
 *
 * No API basis — the official flow is "keep paging until `more` disappears". This is purely an
 * app-side wall-clock bound so one connection cannot eat a whole cron invocation. It is only safe
 * because hitting it pins the cursor (see `truncatedAt`); the next poll resumes the same window.
 */
const MAX_PAGES_PER_WINDOW = 20;

/**
 * Also no API basis: an app policy that stops a long-dead connection from scanning forever.
 * Unlike the page cap this one DOES lose orders — a connection more than 7 days behind has its
 * watermark pulled forward. Logged rather than silent; a real fix needs a backfill path.
 */
const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface NaverSecrets extends ChannelSecrets {
    client_id: string;
    client_secret: string;
    access_token?: string;
    token_expires_at?: number;
}

function requireNaver(secrets: ChannelSecrets): NaverSecrets {
    const client_id = String(secrets.client_id ?? '').trim();
    const client_secret = String(secrets.client_secret ?? '').trim();
    if (!client_id || !client_secret) throw new Error('naver: client_id and client_secret required');
    return {
        ...secrets,
        client_id,
        client_secret,
        access_token: secrets.access_token ? String(secrets.access_token) : undefined,
        token_expires_at: secrets.token_expires_at ? Number(secrets.token_expires_at) : undefined,
    };
}

/** Official Node sample: bcrypt.hashSync(password, clientSecret) then Buffer utf-8 → base64 */
export async function buildNaverSignature(clientId: string, clientSecret: string, timestampMs: number): Promise<string> {
    const password = `${clientId}_${timestampMs}`;
    const hashed = await bcryptHash(password, clientSecret);
    // hashed is ASCII bcrypt string; standard base64 of UTF-8 bytes (matches official Node/Python samples)
    return btoa(hashed);
}

export async function exchangeNaverToken(clientId: string, clientSecret: string): Promise<{
    access_token: string;
    expires_in: number;
}> {
    const timestamp = Date.now();
    const client_secret_sign = await buildNaverSignature(clientId, clientSecret, timestamp);
    const body = new URLSearchParams({
        client_id: clientId,
        timestamp: String(timestamp),
        client_secret_sign,
        grant_type: 'client_credentials',
        type: 'SELF',
    });

    const res = await fetch(`${BASE}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!res.ok) {
        throw new Error(`naver token ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('naver token: missing access_token');
    return { access_token: json.access_token, expires_in: json.expires_in ?? 10800 };
}

async function withToken(secrets: NaverSecrets): Promise<{ token: string; refreshed: NaverSecrets | null }> {
    // Official: re-issue when remaining < 30 minutes
    const reissueSkewMs = 30 * 60 * 1000;
    if (secrets.access_token && secrets.token_expires_at && secrets.token_expires_at - reissueSkewMs > Date.now()) {
        return { token: secrets.access_token, refreshed: null };
    }
    const { access_token, expires_in } = await exchangeNaverToken(secrets.client_id, secrets.client_secret);
    const next: NaverSecrets = {
        ...secrets,
        access_token,
        token_expires_at: Date.now() + expires_in * 1000,
    };
    return { token: access_token, refreshed: next };
}

/** Mint/reuse an access token for one call and persist the re-issue before it is used. */
async function authorizedToken(secrets: ChannelSecrets, onRotate: SecretsRotationSink): Promise<string> {
    const { token, refreshed } = await withToken(requireNaver(secrets));
    if (refreshed) await onRotate(refreshed);
    return token;
}

/** Official date-time example: 2023-01-16T17:14:51.794+09:00 — ISO-8601 with offset is accepted. */
function toNaverDateTime(d: Date): string {
    return d.toISOString().replace(/\.\d{3}Z$/, '.000+00:00');
}

type LastChangedRow = {
    orderId?: string;
    productOrderId?: string;
    productOrderStatus?: string;
    claimStatus?: string;
    lastChangedDate?: string;
    paymentDate?: string;
};

type LastChangedResponse = {
    data?: {
        lastChangeStatuses?: LastChangedRow[];
        more?: { moreFrom?: string; moreSequence?: string | number };
    };
    lastChangeStatuses?: LastChangedRow[];
    more?: { moreFrom?: string; moreSequence?: string | number };
};

async function getLastChanged(
    token: string,
    lastChangedFrom: string,
    lastChangedTo?: string,
    moreSequence?: string,
): Promise<{ rows: LastChangedRow[]; moreFrom?: string; moreSequence?: string }> {
    const url = new URL(`${BASE}/v1/pay-order/seller/product-orders/last-changed-statuses`);
    url.searchParams.set('lastChangedFrom', lastChangedFrom);
    if (lastChangedTo) url.searchParams.set('lastChangedTo', lastChangedTo);
    if (moreSequence) url.searchParams.set('moreSequence', moreSequence);

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
        throw new Error(`naver last-changed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as LastChangedResponse;
    const rows = json.data?.lastChangeStatuses ?? json.lastChangeStatuses ?? [];
    const more = json.data?.more ?? json.more;
    return {
        rows,
        moreFrom: more?.moreFrom,
        moreSequence: more?.moreSequence != null ? String(more.moreSequence) : undefined,
    };
}

/** POST query body: productOrderIds (max 300) — official 상품 주문 상세 내역 조회 */
async function queryProductOrders(token: string, productOrderIds: string[]): Promise<unknown[]> {
    if (!productOrderIds.length) return [];
    const res = await fetch(`${BASE}/v1/pay-order/seller/product-orders/query`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({ productOrderIds }),
    });
    if (!res.ok) {
        throw new Error(`naver product-orders/query ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as {
        data?: unknown[] | { data?: unknown[] };
        // schema wraps as productOrdersInfo array under data
    };
    // Response shape: { data: [ { order, productOrder, ... }, ... ] } per 상품 주문 정보 구조체
    if (Array.isArray(json.data)) return json.data;
    if (json.data && typeof json.data === 'object' && Array.isArray((json.data as { data?: unknown[] }).data)) {
        return (json.data as { data: unknown[] }).data;
    }
    return [];
}

function mapDetail(entry: Record<string, unknown>): CanonicalOrder | null {
    const order = (entry.order ?? {}) as Record<string, unknown>;
    const po = (entry.productOrder ?? entry) as Record<string, unknown>;
    const productOrderId = String(po.productOrderId ?? '');
    const orderId = String(order.orderId ?? po.orderId ?? productOrderId);
    if (!productOrderId && !orderId) return null;

    const status =
        naverToCanonical(String(po.productOrderStatus ?? ''), po.claimStatus != null ? String(po.claimStatus) : null) ??
        'paid';

    const qty = Number(po.remainQuantity ?? po.quantity ?? po.initialQuantity ?? 1) || 1;
    const unitPrice = po.unitPrice != null ? Number(po.unitPrice) : null;
    const totalPay =
        po.remainPaymentAmount != null
            ? Number(po.remainPaymentAmount)
            : po.totalPaymentAmount != null
              ? Number(po.totalPaymentAmount)
              : po.initialPaymentAmount != null
                ? Number(po.initialPaymentAmount)
                : null;

    const lineStatus =
        status === 'cancelled' ? 'cancelled' : status === 'refunded' ? 'refunded' : 'active';

    const line: CanonicalOrderLine = {
        platformLineId: productOrderId || `${orderId}-line`,
        platformProductId: po.productId != null ? String(po.productId) : null,
        platformVariantId: po.optionCode != null
            ? String(po.optionCode)
            : po.optionManageCode != null
              ? String(po.optionManageCode)
              : po.itemNo != null
                ? String(po.itemNo)
                : null,
        title: String(po.productName ?? 'Naver item'),
        quantity: qty,
        unitPrice: unitPrice ?? (totalPay != null && qty ? totalPay / qty : null),
        status: lineStatus,
    };

    return {
        platformOrderId: orderId,
        status,
        orderedAt: String(order.orderDate ?? order.paymentDate ?? po.placeOrderDate ?? new Date().toISOString()),
        buyerName: order.ordererName != null ? String(order.ordererName) : null,
        currency: 'KRW',
        totalAmount: totalPay,
        lines: [line],
        raw: entry,
    };
}

function mergeByOrderId(parts: CanonicalOrder[]): CanonicalOrder[] {
    const map = new Map<string, CanonicalOrder>();
    for (const o of parts) {
        const cur = map.get(o.platformOrderId);
        if (!cur) {
            map.set(o.platformOrderId, { ...o, lines: [...o.lines] });
            continue;
        }
        cur.lines.push(...o.lines);
        // Prefer terminal / higher rank from naverToCanonical merge rules
        if (o.status === 'cancelled' || o.status === 'refunded') cur.status = o.status;
        else if (cur.status !== 'cancelled' && cur.status !== 'refunded') {
            const rank: Record<string, number> = {
                pending: 0,
                paid: 1,
                preparing: 2,
                shipped: 3,
                delivered: 4,
            };
            if ((rank[o.status] ?? 0) > (rank[cur.status] ?? 0)) cur.status = o.status;
        }
        const sum = cur.lines.reduce((n, l) => n + (l.unitPrice ?? 0) * l.quantity, 0);
        if (sum) cur.totalAmount = sum;
    }
    return [...map.values()];
}

export const naverAdapter: ChannelAdapter = {
    platform: 'naver',
    capabilities: { webhooks: false, outboundDispatch: true },

    async testConnection(secrets): Promise<TestConnectionResult> {
        const s = requireNaver(secrets);
        const { token } = await withToken(s);
        // Minimal authenticated call: last-changed 1h window (official endpoint)
        await getLastChanged(token, toNaverDateTime(new Date(Date.now() - 60 * 60 * 1000)));
        return {
            shopIdentifier: s.client_id,
            displayName: 'Naver Smart Store',
        };
    },

    async refreshAuth(secrets): Promise<ChannelSecrets | null> {
        const { refreshed } = await withToken(requireNaver(secrets));
        return refreshed;
    },

    async fetchOrdersSince(secrets, cursor, onRotate): Promise<FetchOrdersResult> {
        const token = await authorizedToken(secrets, onRotate);

        const end = Date.now();
        // Official: omit lastChangedTo → 24h from lastChangedFrom. Walk day windows.
        const requestedStart = cursor.since
            ? new Date(cursor.since).getTime()
            : end - 24 * 60 * 60 * 1000;
        let windowStart = Math.max(requestedStart, end - MAX_LOOKBACK_MS);
        if (windowStart > requestedStart) {
            console.error(
                '[naver] lookback clamp skipped',
                new Date(requestedStart).toISOString(),
                '→',
                new Date(windowStart).toISOString(),
                '— orders in the skipped range are not recoverable from this endpoint',
            );
        }

        const productOrderIds: string[] = [];
        // Lightweight status from last-changed when detail fails
        const statusHint = new Map<
            string,
            { status: string; claim?: string; orderId?: string; orderedAt?: string }
        >();
        /** ms of the first window left half-read by the page cap; null = whole range scanned. */
        let truncatedAt: number | null = null;

        while (windowStart < end) {
            const windowEnd = Math.min(windowStart + 24 * 60 * 60 * 1000, end);
            let moreFrom: string | undefined;
            let moreSequence: string | undefined;
            let pages = 0;

            do {
                const from = moreFrom ?? toNaverDateTime(new Date(windowStart));
                const to = moreFrom ? undefined : toNaverDateTime(new Date(windowEnd));
                const page = await getLastChanged(token, from, to, moreSequence);
                for (const row of page.rows) {
                    if (row.productOrderId) {
                        productOrderIds.push(String(row.productOrderId));
                        statusHint.set(String(row.productOrderId), {
                            status: String(row.productOrderStatus ?? ''),
                            claim: row.claimStatus != null ? String(row.claimStatus) : undefined,
                            orderId: row.orderId != null ? String(row.orderId) : undefined,
                            orderedAt: row.paymentDate ?? row.lastChangedDate,
                        });
                    }
                }
                moreFrom = page.moreFrom;
                moreSequence = page.moreSequence;
                pages += 1;
            } while (moreFrom && pages < MAX_PAGES_PER_WINDOW);

            if (moreFrom) {
                // Page cap hit with pages still unread: stop and leave the watermark inside this
                // window so the next poll re-reads it instead of skipping the remainder.
                truncatedAt = windowStart;
                break;
            }
            windowStart = windowEnd;
        }

        const uniqueIds = [...new Set(productOrderIds)];
        const mapped: CanonicalOrder[] = [];

        // Official max 300 IDs per query call
        for (let i = 0; i < uniqueIds.length; i += 300) {
            const chunk = uniqueIds.slice(i, i + 300);
            try {
                const details = await queryProductOrders(token, chunk);
                for (const d of details) {
                    const order = mapDetail(d as Record<string, unknown>);
                    if (order) mapped.push(order);
                }
            } catch (e) {
                console.error('[naver] product-orders/query failed', e);
                // Fallback: synthesize from last-changed rows only
                for (const id of chunk) {
                    const hint = statusHint.get(id);
                    if (!hint) continue;
                    const status = naverToCanonical(hint.status, hint.claim) ?? 'paid';
                    mapped.push({
                        platformOrderId: hint.orderId ?? id,
                        status,
                        // Real platform timestamps only; `now` would be written to a NOT NULL
                        // column and outlive the outage (see earliestOrderedAt in normalize.ts).
                        orderedAt: hint.orderedAt ?? new Date().toISOString(),
                        buyerName: null,
                        currency: 'KRW',
                        totalAmount: null,
                        lines: [
                            {
                                platformLineId: id,
                                platformProductId: null,
                                platformVariantId: null,
                                title: `Naver ${id}`,
                                quantity: 1,
                                unitPrice: null,
                                status:
                                    status === 'cancelled'
                                        ? 'cancelled'
                                        : status === 'refunded'
                                          ? 'refunded'
                                          : 'active',
                            },
                        ],
                        raw: { productOrderId: id, ...hint },
                    });
                }
            }
        }

        return {
            orders: mergeByOrderId(mapped),
            nextCursor: nextPollCursor({
                complete: truncatedAt === null,
                windowEnd: new Date(end).toISOString(),
                resumeFrom: new Date(truncatedAt ?? end).toISOString(),
            }),
        };
    },

    async listProducts(): Promise<PlatformListing[]> {
        // Product catalog APIs are under a separate product API group; map via sellerProductCode on orders first.
        // Keep empty until product-search endpoint is wired from product docs.
        return [];
    },

    async markShipped(secrets, req: MarkShippedRequest, onRotate): Promise<MarkShippedResult> {
        const token = await authorizedToken(secrets, onRotate);

        const body = buildNaverDispatchPayload(req);
        const res = await fetch(`${BASE}/v1/pay-order/seller/product-orders/dispatch`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(body),
        });
        const text = await res.text();
        let json: NaverDispatchResponse = {};
        try {
            json = text ? JSON.parse(text) : {};
        } catch {
            // keep empty
        }

        if (!res.ok) {
            const msg = (json.message ?? text).slice(0, 500);
            const already =
                /already|already.?dispatched|ALREADY|DISPATCHED/i.test(msg) ||
                json.code === 'ALREADY_DISPATCHED';
            if (already) {
                return { ok: true, alreadyShipped: true, error: msg };
            }
            return { ok: false, alreadyShipped: false, error: `naver dispatch ${res.status}: ${msg}` };
        }

        return readNaverDispatchResult(json, req.lines);
    },
};
