/**
 * Naver order poll loop — extracted from naver.ts so Vitest can load it without bcryptjs.
 */

import { captureEdgeException } from '../sentry.ts';
import {
    getLastChanged,
    type LastChangedRow,
    NaverHttpError,
    queryProductOrders,
    toNaverDateTime,
} from './naver-http.ts';
import { mergeNaverOrdersByOrderId, naverCommercialQuantity, naverPaymentAmount } from './naver-order.ts';
import { NAVER_WINDOW_MS, planNaverScan } from './naver-windows.ts';
import { lineStatusOf } from './normalize.ts';
import { nextPollCursor } from './poll-cursor.ts';
import { naverToCanonical } from './status-map.ts';
import type { CanonicalOrder, CanonicalOrderLine, FetchOrdersResult, PollCursor } from './types.ts';

/** Same bound as naver.ts — app-side wall clock per 24h window. */
export const MAX_PAGES_PER_WINDOW = 20;

export const NAVER_CURSOR_HELD_TAG = 'naver_cursor_held';

type PageResume = { moreFrom: string; moreSequence: string };

type WalkLastChangedInput =
    | { mode: 'window'; scanStart: number; scanEnd: number }
    | { mode: 'resume'; lastChangedFrom: string; moreSequence: string };

async function walkLastChanged(
    accessToken: string,
    productOrderIds: string[],
    input: WalkLastChangedInput,
    maxPages: number,
): Promise<PageResume | null> {
    let moreFrom: string | undefined = input.mode === 'resume' ? input.lastChangedFrom : undefined;
    let moreSequence: string | undefined = input.mode === 'resume' ? input.moreSequence : undefined;
    let pages = 0;

    do {
        const from =
            moreFrom ??
            toNaverDateTime(new Date(input.mode === 'window' ? input.scanStart : Date.parse(input.lastChangedFrom)));
        const to =
            moreFrom || input.mode === 'resume'
                ? undefined
                : toNaverDateTime(new Date((input as { mode: 'window'; scanEnd: number }).scanEnd));
        const page = await getLastChanged(accessToken, from, to, moreSequence);
        collectProductOrderIds(page.rows, productOrderIds);
        moreFrom = page.moreFrom;
        moreSequence = page.moreSequence;
        pages += 1;
    } while (moreFrom && pages < maxPages);

    if (moreFrom && moreSequence) return { moreFrom, moreSequence };
    return null;
}

function collectProductOrderIds(rows: LastChangedRow[], productOrderIds: string[]): void {
    for (const row of rows) {
        if (row.productOrderId) productOrderIds.push(String(row.productOrderId));
    }
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
        platformVariantId:
            po.optionCode != null
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

async function heldCursorResult(incoming: PollCursor, failedIds: string[], cause: unknown): Promise<FetchOrdersResult> {
    const sample = failedIds.slice(0, 5).join(',');
    const suffix = failedIds.length > 5 ? ` (+${failedIds.length - 5} more)` : '';
    const syncNote = `naver detail fetch held cursor (${failedIds.length} ids: ${sample}${suffix})`;
    const err = cause instanceof Error ? cause : new Error(String(cause));
    const upstreamStatus = cause instanceof NaverHttpError ? cause.status : undefined;
    const tags: Record<string, string> = {
        platform: 'naver',
        step: 'product-orders-query',
        [NAVER_CURSOR_HELD_TAG]: 'detail_fetch',
    };
    if (upstreamStatus !== undefined) {
        tags.naver_upstream_status = String(upstreamStatus);
    }
    await captureEdgeException(err, {
        function: 'order-sync',
        status: 502,
        tags,
        extra: {
            failedCount: failedIds.length,
            ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
        },
    });
    return {
        orders: [],
        nextCursor: { since: incoming.since, token: incoming.token },
        cursorHeld: true,
        syncNote,
    };
}

async function walkResumeOrRetryWindow(
    accessToken: string,
    productOrderIds: string[],
    cursor: PollCursor,
): Promise<PageResume | null> {
    if (!cursor.since || !cursor.token) return null;
    try {
        return await walkLastChanged(
            accessToken,
            productOrderIds,
            { mode: 'resume', lastChangedFrom: cursor.since, moreSequence: cursor.token },
            MAX_PAGES_PER_WINDOW,
        );
    } catch (e) {
        if (e instanceof NaverHttpError && e.status >= 400 && e.status < 500) {
            const windowEnd = Math.min(Date.parse(cursor.since) + NAVER_WINDOW_MS, Date.now());
            return walkLastChanged(
                accessToken,
                productOrderIds,
                { mode: 'window', scanStart: Date.parse(cursor.since), scanEnd: windowEnd },
                MAX_PAGES_PER_WINDOW,
            );
        }
        throw e;
    }
}

export async function pollNaverOrders(accessToken: string, cursor: PollCursor): Promise<FetchOrdersResult> {
    const incomingCursor: PollCursor = { since: cursor.since, token: cursor.token };
    const end = Date.now();
    const requestedStart = cursor.since ? new Date(cursor.since).getTime() : end - NAVER_WINDOW_MS;

    const productOrderIds: string[] = [];
    let pageResume: PageResume | null = null;
    let budgetTruncatedAt: number | null = null;
    let planStart = requestedStart;

    if (cursor.since && cursor.token) {
        pageResume = await walkResumeOrRetryWindow(accessToken, productOrderIds, cursor);
        if (!pageResume) {
            // Resume pagination finished the +24h slice that begins at `since`; continue forward.
            planStart = Date.parse(cursor.since) + NAVER_WINDOW_MS;
        }
    }

    if (!pageResume) {
        const plan = planNaverScan(planStart, end);
        budgetTruncatedAt = plan.unscannedFrom;
        for (const scan of plan.windows) {
            pageResume = await walkLastChanged(
                accessToken,
                productOrderIds,
                { mode: 'window', scanStart: scan.start, scanEnd: scan.end },
                MAX_PAGES_PER_WINDOW,
            );
            if (pageResume) {
                budgetTruncatedAt = null;
                break;
            }
        }
    }

    const uniqueIds = [...new Set(productOrderIds)];
    const partialMapped: CanonicalOrder[] = [];
    const failedDetailIds: string[] = [];
    let lastDetailError: unknown;

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
            lastDetailError = e;
            failedDetailIds.push(...chunk);
        }
    }

    if (failedDetailIds.length > 0) {
        const held = await heldCursorResult(incomingCursor, failedDetailIds, lastDetailError ?? new Error('unknown'));
        if (partialMapped.length > 0) {
            return {
                ...held,
                orders: mergeNaverOrdersByOrderId(partialMapped),
            };
        }
        return held;
    }

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
        orders: mergeNaverOrdersByOrderId(partialMapped),
        nextCursor,
    };
}
