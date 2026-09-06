import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapTossPlaceOrder, mergeTossPlaceOrders, tossPlaceAdapter } from './toss-place.ts';

const SECRETS = { merchant_id: '42', access_key: 'ak', secret_key: 'sk' };

function envelope(success: unknown) {
    return { resultType: 'SUCCESS', success };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

const completedOrder = {
    id: 'ord-1',
    merchantId: 42,
    orderState: 'COMPLETED',
    createdAt: '2026-09-01T00:00:00Z',
    completedAt: '2026-09-01T00:05:00Z',
    chargePrice: { totalAmount: 3200, taxAmount: 291, supplyAmount: 2909 },
    lineItems: [
        {
            item: { title: '에티오피아 200g', code: 'ETH-200' },
            itemPrice: { priceValue: 16000 },
            quantity: 2,
        },
    ],
};

describe('mapTossPlaceOrder', () => {
    it('maps COMPLETED to paid with KRW amounts unscaled and item.code as SKU', () => {
        const mapped = mapTossPlaceOrder(completedOrder);
        expect(mapped).toMatchObject({
            platformOrderId: 'ord-1',
            status: 'paid',
            orderedAt: '2026-09-01T00:05:00Z',
            buyerName: null,
            currency: 'KRW',
            totalAmount: 3200,
        });
        expect(mapped?.lines).toEqual([
            {
                platformLineId: 'ord-1:0',
                platformProductId: 'ETH-200',
                platformVariantId: null,
                sku: 'ETH-200',
                title: '에티오피아 200g',
                quantity: 2,
                unitPrice: 16000,
                status: 'active',
            },
        ]);
        expect((mapped?.raw as { chargePrice?: { taxAmount?: number } }).chargePrice?.taxAmount).toBe(291);
    });

    it('maps CANCELLED lines to cancelled', () => {
        const mapped = mapTossPlaceOrder({ ...completedOrder, orderState: 'CANCELLED' });
        expect(mapped?.status).toBe('cancelled');
        expect(mapped?.lines[0]?.status).toBe('cancelled');
    });

    it('skips OPENED / REQUESTED / missing id', () => {
        expect(mapTossPlaceOrder({ ...completedOrder, orderState: 'OPENED' })).toBeNull();
        expect(mapTossPlaceOrder({ ...completedOrder, orderState: 'REQUESTED' })).toBeNull();
        expect(mapTossPlaceOrder({ ...completedOrder, id: '' })).toBeNull();
    });
});

describe('mergeTossPlaceOrders', () => {
    it('lets a later CANCELLED overlay a COMPLETED id (late refund)', () => {
        const paid = mapTossPlaceOrder(completedOrder);
        const cancelled = mapTossPlaceOrder({ ...completedOrder, orderState: 'CANCELLED' });
        expect(paid && cancelled).toBeTruthy();
        const merged = mergeTossPlaceOrders([paid!], [cancelled!]);
        expect(merged).toHaveLength(1);
        expect(merged[0]?.status).toBe('cancelled');
    });
});

describe('tossPlaceAdapter', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('testConnection uses merchant GET and env-or-secret keys', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse(envelope({ id: 42, name: '플레이스 베이커리', displayName: 'Place Bakery' })),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(tossPlaceAdapter.testConnection(SECRETS)).resolves.toEqual({
            shopIdentifier: '42',
            displayName: 'Place Bakery',
        });
        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://open-api.tossplace.com/api-public/openapi/v1/merchants/42');
        expect((init.headers as Record<string, string>)['x-access-key']).toBe('ak');
        expect((init.headers as Record<string, string>)['x-secret-key']).toBe('sk');
    });

    it('fetchOrdersSince pulls COMPLETED+CANCELLED then a trailing CANCELLED rescan', async () => {
        const fetchMock = vi.fn().mockImplementation((url: string) => {
            const u = new URL(url);
            const states = u.searchParams.getAll('orderStates');
            if (states.length === 1 && states[0] === 'CANCELLED') {
                return Promise.resolve(jsonResponse(envelope([{ ...completedOrder, orderState: 'CANCELLED' }])));
            }
            return Promise.resolve(jsonResponse(envelope([completedOrder])));
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await tossPlaceAdapter.fetchOrdersSince(SECRETS, {
            since: '2026-09-01T00:00:00.000Z',
        });
        expect(result.orders).toHaveLength(1);
        expect(result.orders[0]?.status).toBe('cancelled');
        expect(result.nextCursor.since).toBeTruthy();

        const urls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes('orderStates=COMPLETED'))).toBe(true);
        expect(urls.filter((u) => u.includes('orderStates=CANCELLED') && !u.includes('COMPLETED')).length).toBeGreaterThan(
            0,
        );
    });

    it('listProducts prefers catalog code as the mapping key', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse(envelope([{ id: 'item-9', title: '에티오피아 200g', code: 'ETH-200' }])),
            ),
        );
        await expect(tossPlaceAdapter.listProducts(SECRETS, async () => undefined)).resolves.toEqual([
            {
                platformProductId: 'ETH-200',
                platformVariantId: null,
                title: '에티오피아 200g',
                sku: 'ETH-200',
            },
        ]);
    });

    it('markShipped is pull-only', async () => {
        await expect(
            tossPlaceAdapter.markShipped(
                SECRETS,
                { platformOrderId: 'x', lines: [], carrierCode: '', trackingNumber: '' },
                async () => undefined,
            ),
        ).resolves.toEqual({ ok: false, alreadyShipped: false, error: 'not supported' });
    });

    it('rejects a non-numeric merchant_id', async () => {
        await expect(tossPlaceAdapter.testConnection({ merchant_id: 'abc' })).rejects.toThrow(/merchant_id/);
    });
});
