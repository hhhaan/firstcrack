import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAFE24_PRIMARY_MAX_PAGES, cafe24Adapter } from './cafe24.ts';
import type { ChannelSecrets, PollCursor } from './types.ts';

const NOW = '2026-07-27T00:00:00.000Z';
const SINCE = '2026-07-20T00:00:00.000Z';

const secrets: ChannelSecrets = { mall_id: 'shop1', access_token: 'tok' };
const noRotate = async () => {};

function makeOrder(id: string) {
    return {
        order_id: id,
        paid: 'T',
        canceled: 'F',
        order_date: '2026-07-21T10:00:00+09:00',
        billing_name: 'Buyer',
        currency: 'KRW',
        items: [{ order_item_code: `${id}-1`, product_no: 11, product_name: 'Beans', quantity: 1 }],
    };
}

function stubPrimaryPages(totalOrders: number) {
    const pages: Record<string, unknown>[][] = [];
    for (let o = 0; o < totalOrders; o += 100) {
        const page: Record<string, unknown>[] = [];
        for (let i = 0; i < 100 && o + i < totalOrders; i++) {
            page.push(makeOrder(`ORD-${o + i}`));
        }
        pages.push(page);
    }

    vi.stubGlobal('fetch', async (input: URL | string) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith('/orders')) {
            return new Response(JSON.stringify({}), { status: 200 });
        }
        const dateType = url.searchParams.get('date_type') ?? '';
        if (dateType !== 'order_date') {
            return new Response(JSON.stringify({ orders: [] }), { status: 200 });
        }
        const offset = Number(url.searchParams.get('offset') ?? '0');
        const pageIndex = offset / 100;
        const batch = pages[pageIndex] ?? [];
        return new Response(JSON.stringify({ orders: batch }), { status: 200 });
    });
}

describe('cafe24 primary poll page resume (#900)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(NOW));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('collects 4100 orders across two runs with monotonic offset token', async () => {
        stubPrimaryPages(4100);
        const cursor: PollCursor = { since: SINCE };

        const first = await cafe24Adapter.fetchOrdersSince(secrets, cursor, noRotate);
        expect(first.orders).toHaveLength(CAFE24_PRIMARY_MAX_PAGES * 100);
        expect(first.nextCursor.since).toBe(SINCE);
        expect(first.nextCursor.token).toBe('4000');

        const second = await cafe24Adapter.fetchOrdersSince(secrets, first.nextCursor, noRotate);
        const ids = new Set([...first.orders, ...second.orders].map((o) => o.platformOrderId));
        expect(ids.size).toBe(4100);
        expect(second.nextCursor.since).toBe(NOW);
        expect(second.nextCursor.token).toBeUndefined();
    });
});
