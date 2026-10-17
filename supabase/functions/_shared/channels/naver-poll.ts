/**
 * Naver order poll loop — extracted from naver.ts so Vitest can load it without bcryptjs.
 */

import { captureEdgeException } from '../sentry.ts';
import { mergeNaverOrdersByOrderId, naverCommercialQuantity, naverPaymentAmount } from './naver-order.ts';
import { planNaverScan } from './naver-windows.ts';
import { lineStatusOf } from './normalize.ts';
import { nextPollCursor } from './poll-cursor.ts';
import { type HttpAttempt, naverThrottle, readHttpAttempt, withRetry } from './rate-limit.ts';
import { naverToCanonical } from './status-map.ts';
import type { CanonicalOrder, CanonicalOrderLine, FetchOrdersResult, PollCursor } from './types.ts';

const BASE = 'https://api.commerce.naver.com/external';

/** Same bound as naver.ts — app-side wall clock per 24h window. */
export const MAX_PAGES_PER_WINDOW = 20;

export const NAVER_CURSOR_HELD_TAG = 'naver_cursor_held';

async function naverRequest(url: URL | string, init?: RequestInit): Promise<HttpAttempt> {
    return withRetry(() => fetch(url, init).then(readHttpAttempt), naverThrottle, { label: 'naver' });
}

function okStatus(attempt: HttpAttempt): boolean {
    return attempt.status >= 200 && attempt.status < 300;
}

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
    accessToken: string,
    lastChangedFrom: string,
    lastChangedTo?: string,
    moreSequence?: string,
): Promise<{ rows: LastChangedRow[]; moreFrom?: string; moreSequence?: string }> {
    const url = new URL(`${BASE}/v1/pay-order/seller/product-orders/last-changed-statuses`);
    url.searchParams.set('lastChangedFrom', lastChangedFrom);
    if (lastChangedTo) url.searchParams.set('lastChangedTo', lastChangedTo);
    if (moreSequence) url.searchParams.set('moreSequence', moreSequence);

    const res = await naverRequest(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!okStatus(res)) {
        throw new Error(`naver last-changed ${res.status}: ${res.body.slice(0, 300)}`);
    }
    const json = JSON.parse(res.body) as LastChangedResponse;
    const rows = json.data?.lastChangeStatuses ?? json.lastChangeStatuses ?? [];
    const more = json.data?.more ?? json.more;
    return {
        rows,
        moreFrom: more?.moreFrom,
        moreSequence: more?.moreSequence != null ? String(more.moreSequence) : undefined,
    };
}

async function queryProductOrders(accessToken: string, productOrderIds: string[]): Promise<unknown[]> {
    if (!productOrderIds.length) return [];
    const res = await naverRequest(`${BASE}/v1/pay-order/seller/product-orders/query`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({ productOrderIds }),
    });
    if (!okStatus(res)) {
        throw new Error(`naver product-orders/query ${res.status}: ${res.body.slice(0, 300)}`);
    }
    const json = JSON.parse(res.body) as { data?: unknown[] | { data?: unknown[] } };
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

    const lineStatus = lineStatusOf(status);
    const terminal = lineStatus !== 'active';
    const qty = naverCommercialQuantity(po, terminal);
    const totalPay = naverPaymentAmount(po, terminal);
    const parsedUnit = po.unitPrice != null ? Number(po.unitPrice) : null;
    const unitPrice = parsedUnit != null && Number.isFinite(parsedUnit) ? parsedUnit : null;

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

type PageResume = { moreFrom: string; moreSequence: string };

async function walkLastChangedWindow(
    accessToken: string,
    productOrderIds: string[],
    scanStart: number,
    scanEnd: number,
): Promise<PageResume | null> {
    let moreFrom: string | undefined;
    let moreSequence: string | undefined;
    let pages = 0;

    do {
        const from = moreFrom ?? toNaverDateTime(new Date(scanStart));
        const to = moreFrom ? undefined : toNaverDateTime(new Date(scanEnd));
        const page = await getLastChanged(accessToken, from, to, moreSequence);
        for (const row of page.rows) {
            if (row.productOrderId) productOrderIds.push(String(row.productOrderId));
        }
        moreFrom = page.moreFrom;
        moreSequence = page.moreSequence;
        pages += 1;
    } while (moreFrom && pages < MAX_PAGES_PER_WINDOW);

    if (moreFrom && moreSequence) return { moreFrom, moreSequence };
    return null;
}

async function walkLastChangedResume(
    accessToken: string,
    productOrderIds: string[],
    lastChangedFrom: string,
    moreSequence: string,
): Promise<PageResume | null> {
    let moreFrom: string | undefined = lastChangedFrom;
    let sequence: string | undefined = moreSequence;
    let pages = 0;

    do {
        const page = await getLastChanged(accessToken, moreFrom, undefined, sequence);
        for (const row of page.rows) {
            if (row.productOrderId) productOrderIds.push(String(row.productOrderId));
        }
        moreFrom = page.moreFrom;
        sequence = page.moreSequence;
        pages += 1;
    } while (moreFrom && pages < MAX_PAGES_PER_WINDOW);

    if (moreFrom && sequence) return { moreFrom, moreSequence: sequence };
    return null;
}

function heldCursorResult(
    incoming: PollCursor,
    failedIds: string[],
    cause: unknown,
): FetchOrdersResult {
    const sample = failedIds.slice(0, 5).join(',');
    const suffix = failedIds.length > 5 ? ` (+${failedIds.length - 5} more)` : '';
    const syncNote = `naver detail fetch held cursor (${failedIds.length} ids: ${sample}${suffix})`;
    const err = cause instanceof Error ? cause : new Error(String(cause));
    void captureEdgeException(err, {
        function: 'order-sync',
        status: 502,
        tags: { platform: 'naver', step: 'product-orders-query', [NAVER_CURSOR_HELD_TAG]: 'detail_fetch' },
        extra: { failedCount: failedIds.length },
    });
    return {
        orders: [],
        nextCursor: { since: incoming.since, token: incoming.token },
        cursorHeld: true,
        syncNote,
    };
}

export async function pollNaverOrders(accessToken: string, cursor: PollCursor): Promise<FetchOrdersResult> {
    const incomingCursor: PollCursor = { since: cursor.since, token: cursor.token };
    const end = Date.now();
    const requestedStart = cursor.since ? new Date(cursor.since).getTime() : end - 24 * 60 * 60 * 1000;
    const plan = planNaverScan(requestedStart, end);

    const productOrderIds: string[] = [];
    let pageResume: PageResume | null = null;
    let budgetTruncatedAt: number | null = plan.unscannedFrom;

    if (cursor.since && cursor.token) {
        pageResume = await walkLastChangedResume(accessToken, productOrderIds, cursor.since, cursor.token);
    } else {
        for (const scan of plan.windows) {
            pageResume = await walkLastChangedWindow(accessToken, productOrderIds, scan.start, scan.end);
            if (pageResume) {
                budgetTruncatedAt = null;
                break;
            }
        }
    }

    const uniqueIds = [...new Set(productOrderIds)];
    const mapped: CanonicalOrder[] = [];
    const failedDetailIds: string[] = [];
    let partialMapped: CanonicalOrder[] = [];

    for (let i = 0; i < uniqueIds.length; i += 300) {
        const chunk = uniqueIds.slice(i, i + 300);
        try {
            const details = await queryProductOrders(accessToken, chunk);
            for (const d of details) {
                const order = mapDetail(d as Record<string, unknown>);
                if (order) partialMapped.push(order);
            }
        } catch (e) {
            console.error('[naver] product-orders/query failed', e);
            failedDetailIds.push(...chunk);
        }
    }

    if (failedDetailIds.length > 0) {
        const held = heldCursorResult(incomingCursor, failedDetailIds, new Error('naver product-orders/query failed'));
        if (partialMapped.length > 0) {
            return {
                ...held,
                orders: mergeNaverOrdersByOrderId(partialMapped),
            };
        }
        return held;
    }

    mapped.push(...partialMapped);

    const windowEnd = new Date(end).toISOString();
    const nextCursor = pageResume
        ? nextPollCursor({
              complete: false,
              windowEnd,
              resumeFrom: pageResume.moreFrom,
              resumeToken: pageResume.moreSequence,
          })
        : nextPollCursor({
              complete: budgetTruncatedAt === null,
              windowEnd,
              resumeFrom: new Date(budgetTruncatedAt ?? end).toISOString(),
          });

    return {
        orders: mergeNaverOrdersByOrderId(mapped),
        nextCursor,
    };
}
