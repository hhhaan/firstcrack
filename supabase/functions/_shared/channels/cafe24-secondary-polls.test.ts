import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CAFE24_PRIMARY_MAX_PAGES,
    CAFE24_SECONDARY_LOOKBACK_DAYS,
    CAFE24_SECONDARY_MAX_PAGES,
    cafe24Adapter,
} from './cafe24.ts';
import type { ChannelSecrets, PollCursor } from './types.ts';

/**
 * #141: Cafe24 has no `updated_date` date_type, so the order_date poll permanently misses
 * status changes on orders placed before the cursor window. fetchOrdersSince must run the
 * primary order_date poll plus cancel_date / shipbegin_date secondary polls over a wider
 * fixed lookback, deduped by order_id.
 */

const NOW = '2026-07-27T00:00:00.000Z';
const SINCE = '2026-07-20T00:00:00.000Z';

const secrets: ChannelSecrets = { mall_id: 'shop1', access_token: 'tok' };
const cursor: PollCursor = { since: SINCE };
const noRotate = async () => {};

type RawOrder = Record<string, unknown>;

function makeOrder(id: string, over: RawOrder = {}): RawOrder {
    return {
        order_id: id,
        paid: 'T',
        canceled: 'F',
        order_date: '2026-07-21T10:00:00+09:00',
        billing_name: 'Buyer',
        currency: 'KRW',
        items: [{ order_item_code: `${id}-1`, product_no: 11, product_name: 'Beans', quantity: 1 }],
        ...over,
    };
}

/** Routes GET /orders by date_type; records every /orders query for assertions. */
function stubOrdersFetch(pages: Record<string, RawOrder[][]>): URLSearchParams[] {
    const seen: URLSearchParams[] = [];
    vi.stubGlobal('fetch', async (input: URL | string) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith('/orders')) {
            return new Response(JSON.stringify({}), { status: 200 });
        }
        seen.push(url.searchParams);
        const dateType = url.searchParams.get('date_type') ?? '';
        const offset = Number(url.searchParams.get('offset') ?? '0');
        const limit = Number(url.searchParams.get('limit') ?? '100');
        const page = (pages[dateType] ?? [])[offset / limit] ?? [];
        return new Response(JSON.stringify({ orders: page }), { status: 200 });
    });
    return seen;
}

describe('cafe24 secondary polls (#141)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(NOW));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('polls order_date over the cursor window, then cancel_date and shipbegin_date over the wider lookback', async () => {
        const seen = stubOrdersFetch({ order_date: [[makeOrder('A')]], cancel_date: [[]], shipbegin_date: [[]] });

        await cafe24Adapter.fetchOrdersSince(secrets, cursor, noRotate);

        expect(seen.map((q) => q.get('date_type'))).toEqual(['order_date', 'cancel_date', 'shipbegin_date']);

        const [primary, cancel, shipbegin] = seen;
        expect(primary.get('start_date')).toBe('2026-07-20');
        expect(primary.get('end_date')).toBe('2026-07-27');

        const lookbackStart = new Date(Date.parse(NOW) - CAFE24_SECONDARY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);
        for (const q of [cancel, shipbegin]) {
            expect(q.get('start_date')).toBe(lookbackStart);
            expect(q.get('end_date')).toBe('2026-07-27');
            expect(q.get('embed')).toBe('items,buyer');
            expect(q.get('limit')).toBe('100');
        }
    });

    it('dedupes an order returned by both the primary and a secondary poll', async () => {
        const cancelled = makeOrder('B', { canceled: 'T' });
        stubOrdersFetch({
            order_date: [[makeOrder('A'), cancelled]],
            cancel_date: [[cancelled]],
            shipbegin_date: [[]],
        });

        const { orders } = await cafe24Adapter.fetchOrdersSince(secrets, cursor, noRotate);

        expect(orders.map((o) => o.platformOrderId).sort()).toEqual(['A', 'B']);
    });

    it('maps a pre-window cancellation to canonical cancelled and a shipbegin to shipped', async () => {
        stubOrdersFetch({
            order_date: [[]],
            cancel_date: [[makeOrder('OLD-CANCEL', { canceled: 'T', order_date: '2026-06-30T09:00:00+09:00' })]],
            shipbegin_date: [[makeOrder('OLD-SHIP', { shipping_status: 'M' })]],
        });

        const { orders } = await cafe24Adapter.fetchOrdersSince(secrets, cursor, noRotate);

        const byId = new Map(orders.map((o) => [o.platformOrderId, o.status]));
        expect(byId.get('OLD-CANCEL')).toBe('cancelled');
        expect(byId.get('OLD-SHIP')).toBe('shipped');
    });

    it('advances the watermark when the primary poll is complete, even if a secondary poll hits its page cap', async () => {
        const fullPage = (prefix: string, page: number) =>
            Array.from({ length: 100 }, (_, i) => makeOrder(`${prefix}-${page}-${i}`, { canceled: 'T' }));
        stubOrdersFetch({
            order_date: [[makeOrder('A')]],
            cancel_date: Array.from({ length: CAFE24_SECONDARY_MAX_PAGES + 1 }, (_, p) => fullPage('C', p)),
            shipbegin_date: [[]],
        });

        const { nextCursor } = await cafe24Adapter.fetchOrdersSince(secrets, cursor, noRotate);

        expect(nextCursor.since).toBe(NOW);
    });

    it('holds the watermark when the primary poll hits its page cap', async () => {
        const fullPage = (page: number) => Array.from({ length: 100 }, (_, i) => makeOrder(`P-${page}-${i}`));
        stubOrdersFetch({
            order_date: Array.from({ length: CAFE24_PRIMARY_MAX_PAGES + 1 }, (_, p) => fullPage(p)),
            cancel_date: [[]],
            shipbegin_date: [[]],
        });

        const { nextCursor } = await cafe24Adapter.fetchOrdersSince(secrets, cursor, noRotate);

        expect(nextCursor.since).toBe(SINCE);
    });

    it('splits the old 50-page budget across the three polls', () => {
        expect(CAFE24_PRIMARY_MAX_PAGES + 2 * CAFE24_SECONDARY_MAX_PAGES).toBe(50);
    });
});
