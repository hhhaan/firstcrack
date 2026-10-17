import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAVER_WINDOW_MS } from './naver-windows.ts';
import { pollNaverOrders } from './naver-poll.ts';
import type { PollCursor } from './types.ts';

const NOW_MS = Date.parse('2026-07-26T12:00:00.000Z');
const SINCE_MS = Date.parse('2026-07-21T12:19:00.000Z');

type StubChange = { productOrderId: string; changedAtMs: number };

function parseQueryTime(iso: string): number {
    return Date.parse(iso);
}

function windowEndMs(fromMs: number, lastChangedTo?: string | null): number {
    if (lastChangedTo) return parseQueryTime(lastChangedTo);
    return fromMs + NAVER_WINDOW_MS;
}

function stubNaverFetch(changes: StubChange[]) {
    const sorted = [...changes].sort((a, b) => a.changedAtMs - b.changedAtMs);

    vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('last-changed-statuses')) {
            const u = new URL(url);
            const fromMs = parseQueryTime(u.searchParams.get('lastChangedFrom') ?? '');
            const toMs = windowEndMs(fromMs, u.searchParams.get('lastChangedTo'));
            const seq = u.searchParams.get('moreSequence');
            let slice = sorted.filter((c) => c.changedAtMs >= fromMs && c.changedAtMs < toMs);
            if (seq) {
                const idx = slice.findIndex((c) => c.productOrderId === seq);
                slice = idx >= 0 ? slice.slice(idx + 1) : slice;
            }
            const pageSize = 1;
            const page = slice.slice(0, pageSize);
            const more =
                slice.length > pageSize
                    ? {
                          moreFrom: new Date(fromMs).toISOString().replace(/\.\d{3}Z$/, '.000+00:00'),
                          moreSequence: page[0]?.productOrderId,
                      }
                    : undefined;
            const rows = page.map((c) => ({
                productOrderId: c.productOrderId,
                orderId: `O-${c.productOrderId}`,
                productOrderStatus: 'PAYED',
                lastChangedDate: new Date(c.changedAtMs).toISOString(),
                paymentDate: new Date(c.changedAtMs).toISOString(),
            }));
            return new Response(JSON.stringify({ data: { lastChangeStatuses: rows, more } }), { status: 200 });
        }
        if (url.includes('product-orders/query')) {
            const rawBody = init?.body != null ? String(init.body) : '{}';
            const body = JSON.parse(rawBody) as { productOrderIds?: string[] };
            const data = (body.productOrderIds ?? []).map((id) => ({
                order: { orderId: `O-${id}`, orderDate: '2026-07-22T09:00:00+09:00' },
                productOrder: {
                    productOrderId: id,
                    productId: 'P1',
                    productName: 'Item',
                    quantity: 1,
                    unitPrice: 1000,
                    productOrderStatus: 'PAYED',
                },
            }));
            return new Response(JSON.stringify({ data }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
    });
}

describe('pollNaverOrders resume does not skip days after +24h continuation (#900)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(NOW_MS));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('collects daily changes after finishing a token resume within the same +24h slice', async () => {
        const hourMs = 60 * 60 * 1000;
        const changes: StubChange[] = [
            ...Array.from({ length: 30 }, (_, i) => ({
                productOrderId: `BULK-${i}`,
                changedAtMs: SINCE_MS + hourMs,
            })),
            { productOrderId: 'DAY-22', changedAtMs: Date.parse('2026-07-22T12:00:00.000Z') },
            { productOrderId: 'DAY-23', changedAtMs: Date.parse('2026-07-23T12:00:00.000Z') },
            { productOrderId: 'DAY-24', changedAtMs: Date.parse('2026-07-24T12:00:00.000Z') },
            { productOrderId: 'DAY-25', changedAtMs: Date.parse('2026-07-25T12:00:00.000Z') },
        ];
        stubNaverFetch(changes);

        const run0 = await pollNaverOrders('tok', { since: new Date(SINCE_MS).toISOString() });
        expect(run0.nextCursor.token).toBeTruthy();
        expect(run0.nextCursor.since).toBeTruthy();

        const run1 = await pollNaverOrders('tok', run0.nextCursor);
        const lineIds = [...run0.orders, ...run1.orders].flatMap((o) => o.lines.map((l) => l.platformLineId));

        for (const day of ['DAY-22', 'DAY-23', 'DAY-24', 'DAY-25']) {
            expect(lineIds).toContain(day);
        }
        expect(run1.nextCursor.token).toBeUndefined();
        expect(run1.nextCursor.since).toBe(new Date(NOW_MS).toISOString());
    });
});
