import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cafe24Adapter } from './cafe24.ts';
import type { ChannelSecrets } from './types.ts';

const secrets: ChannelSecrets = { mall_id: 'shop1', access_token: 'tok' };
const noRotate = async () => {};

const req = {
    platformOrderId: 'order-1',
    lines: [{ platformLineId: 'item-a' }, { platformLineId: 'item-b' }],
    carrierCode: '0006',
    trackingNumber: 'TRACK-1',
};

function stubFetch(handlers: {
    post?: () => Response;
    getShipments?: () => Response;
}) {
    vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'POST' && url.includes('/shipments') && handlers.post) {
            return handlers.post();
        }
        if (method === 'GET' && url.includes('/shipments') && handlers.getShipments) {
            return handlers.getShipments();
        }
        return new Response('{}', { status: 404 });
    });
}

describe('cafe24Adapter.markShipped (#905)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('fails on unrelated 409 when no shipment matches', async () => {
        stubFetch({
            post: () => new Response('Synthetic state conflict: no shipment was created', { status: 409 }),
            getShipments: () => new Response(JSON.stringify({ shipments: [] }), { status: 200 }),
        });
        const result = await cafe24Adapter.markShipped(secrets, req, noRotate);
        expect(result.ok).toBe(false);
        expect(result.alreadyShipped).toBe(false);
    });

    it('does not treat English or Korean error text alone as already shipped', async () => {
        for (const body of ['already shipped', '이미 출고된 주문입니다']) {
            stubFetch({
                post: () => new Response(body, { status: 422 }),
                getShipments: () => new Response(JSON.stringify({ shipments: [] }), { status: 200 }),
            });
            const result = await cafe24Adapter.markShipped(secrets, req, noRotate);
            expect(result.ok).toBe(false);
            expect(result.alreadyShipped).toBe(false);
        }
    });

    it('succeeds as alreadyShipped when GET lists matching tracking and item codes', async () => {
        stubFetch({
            post: () => new Response('conflict', { status: 409 }),
            getShipments: () =>
                new Response(
                    JSON.stringify({
                        shipments: [
                            {
                                tracking_no: 'TRACK-1',
                                order_item_code: ['item-a', 'item-b'],
                            },
                        ],
                    }),
                    { status: 200 },
                ),
        });
        const result = await cafe24Adapter.markShipped(secrets, req, noRotate);
        expect(result).toMatchObject({ ok: true, alreadyShipped: true });
        expect(result.lineResults?.every((r) => r.ok)).toBe(true);
    });

    it('accepts nested items[].order_item_code on shipments', async () => {
        stubFetch({
            post: () => new Response('conflict', { status: 409 }),
            getShipments: () =>
                new Response(
                    JSON.stringify({
                        shipments: [
                            {
                                tracking_no: 'TRACK-1',
                                items: [{ order_item_code: 'item-a' }, { order_item_code: 'item-b' }],
                            },
                        ],
                    }),
                    { status: 200 },
                ),
        });
        const result = await cafe24Adapter.markShipped(secrets, req, noRotate);
        expect(result.ok).toBe(true);
        expect(result.alreadyShipped).toBe(true);
    });

    it('fails when tracking matches but item codes are only a subset', async () => {
        stubFetch({
            post: () => new Response('conflict', { status: 409 }),
            getShipments: () =>
                new Response(
                    JSON.stringify({
                        shipments: [{ tracking_no: 'TRACK-1', order_item_code: ['item-a'] }],
                    }),
                    { status: 200 },
                ),
        });
        const result = await cafe24Adapter.markShipped(secrets, req, noRotate);
        expect(result.ok).toBe(false);
    });

    it('fails when shipment GET fails after POST error', async () => {
        stubFetch({
            post: () => new Response('conflict', { status: 409 }),
            getShipments: () => new Response('down', { status: 500 }),
        });
        const result = await cafe24Adapter.markShipped(secrets, req, noRotate);
        expect(result.ok).toBe(false);
    });

    it('returns ok on 201 without listing shipments', async () => {
        let fetchCalls = 0;
        vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
            fetchCalls += 1;
            const url = String(input);
            if ((init?.method ?? 'GET') === 'POST' && url.includes('/shipments')) {
                return new Response('{}', { status: 201 });
            }
            return new Response('{}', { status: 404 });
        });
        const result = await cafe24Adapter.markShipped(secrets, req, noRotate);
        expect(result).toMatchObject({ ok: true, alreadyShipped: false });
        expect(fetchCalls).toBe(1);
    });
});
