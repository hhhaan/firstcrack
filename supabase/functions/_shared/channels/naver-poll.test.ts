import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollNaverOrders } from './naver-poll.ts';
import type { PollCursor } from './types.ts';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const SINCE = '2026-07-19T12:00:00.000+00:00';
const MORE_FROM = '2026-07-20T08:00:00.000+00:00';

function detailPayload(productOrderId: string, qty: number, productId: string, unitPrice: number) {
    return {
        order: { orderId: `O-${productOrderId}`, orderDate: '2026-07-20T09:00:00+09:00' },
        productOrder: {
            productOrderId,
            productId,
            productName: 'Item',
            quantity: qty,
            unitPrice,
            productOrderStatus: 'PAYED',
        },
    };
}

describe('pollNaverOrders (#900 page resume, #902 detail hold)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(NOW));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('requires moreSequence to read past the page cap', async () => {
        const pages: Array<{ seq?: string; ids: string[] }> = [];
        for (let p = 0; p < 21; p++) {
            pages.push({
                seq: p === 0 ? undefined : `seq-${p}`,
                ids: [`PO-${p}`],
            });
        }

        vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
            const url = String(input);
            if (url.includes('last-changed-statuses')) {
                const u = new URL(url);
                const seq = u.searchParams.get('moreSequence') ?? '';
                const pageIndex = seq ? Number(seq.replace('seq-', '')) : 0;
                const page = pages[pageIndex];
                if (!page) {
                    return new Response(JSON.stringify({ data: { lastChangeStatuses: [] } }), { status: 200 });
                }
                const rows = page.ids.map((id) => ({
                    productOrderId: id,
                    orderId: `O-${id}`,
                    productOrderStatus: 'PAYED',
                    paymentDate: '2026-07-20T09:00:00+09:00',
                }));
                const more =
                    pageIndex < pages.length - 1
                        ? { moreFrom: MORE_FROM, moreSequence: `seq-${pageIndex + 1}` }
                        : undefined;
                return new Response(JSON.stringify({ data: { lastChangeStatuses: rows, more } }), { status: 200 });
            }
            if (url.includes('product-orders/query')) {
                const rawBody =
                    typeof init === 'object' && init?.body != null
                        ? String(init.body)
                        : input instanceof Request
                          ? await input.clone().text()
                          : '{}';
                const body = JSON.parse(rawBody) as { productOrderIds?: string[] };
                const ids = body.productOrderIds ?? [];
                const data = ids.map((id) => detailPayload(id, 2, 'PROD-1', 5000));
                return new Response(JSON.stringify({ data }), { status: 200 });
            }
            return new Response('{}', { status: 404 });
        });

        const cursor: PollCursor = { since: SINCE };
        const first = await pollNaverOrders('tok', cursor);
        expect(first.nextCursor.since).toBe(MORE_FROM);
        expect(first.nextCursor.token).toBe('seq-20');

        const second = await pollNaverOrders('tok', first.nextCursor);
        const allIds = [...first.orders, ...second.orders].flatMap((o) => o.lines.map((l) => l.platformLineId));
        expect(new Set(allIds).size).toBe(21);
    });

    it('holds cursor and omits orders when product-orders/query returns 500', async () => {
        vi.stubGlobal('fetch', async (input: URL | string, _init?: RequestInit) => {
            const url = String(input);
            if (url.includes('last-changed-statuses')) {
                return new Response(
                    JSON.stringify({
                        data: {
                            lastChangeStatuses: [
                                {
                                    productOrderId: 'PO-FAIL',
                                    orderId: 'O-1',
                                    productOrderStatus: 'PAYED',
                                    paymentDate: '2026-07-20T09:00:00+09:00',
                                },
                            ],
                        },
                    }),
                    { status: 200 },
                );
            }
            if (url.includes('product-orders/query')) {
                return new Response('error', { status: 500 });
            }
            return new Response('{}', { status: 404 });
        });

        const cursor: PollCursor = { since: SINCE };
        const result = await pollNaverOrders('tok', cursor);
        expect(result.orders).toHaveLength(0);
        expect(result.nextCursor).toEqual(cursor);
        expect(result.cursorHeld).toBe(true);
        expect(result.syncNote).toMatch(/held cursor/i);
    });

    it('upserts successful chunks but holds cursor when a later chunk fails', async () => {
        let queryCalls = 0;
        const manyIds = Array.from({ length: 301 }, (_, i) => `PO-${i}`);
        vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
            const url = String(input);
            if (url.includes('last-changed-statuses')) {
                const rows = manyIds.map((id) => ({
                    productOrderId: id,
                    orderId: `O-${id}`,
                    productOrderStatus: 'PAYED',
                    paymentDate: '2026-07-20T09:00:00+09:00',
                }));
                return new Response(JSON.stringify({ data: { lastChangeStatuses: rows } }), { status: 200 });
            }
            if (url.includes('product-orders/query')) {
                queryCalls += 1;
                const rawBody = init?.body != null ? String(init.body) : '{}';
                const body = JSON.parse(rawBody) as { productOrderIds?: string[] };
                if (queryCalls === 1) {
                    const data = (body.productOrderIds ?? []).map((id) => detailPayload(id, 3, 'P1', 9000));
                    return new Response(JSON.stringify({ data }), { status: 200 });
                }
                return new Response('fail', { status: 500 });
            }
            return new Response('{}', { status: 404 });
        });

        const cursor: PollCursor = { since: SINCE };
        const result = await pollNaverOrders('tok', cursor);
        expect(result.orders).toHaveLength(300);
        expect(result.orders[0].lines[0].quantity).toBe(3);
        expect(result.nextCursor).toEqual(cursor);
        expect(result.cursorHeld).toBe(true);
        expect(queryCalls).toBe(2);
    });
});
