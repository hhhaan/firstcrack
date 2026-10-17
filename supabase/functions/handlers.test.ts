import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CAFE24_ITEMLESS_ORDER_ID,
    cafe24ItemlessDetailOrder,
    cafe24ItemlessWebhookPayload,
    cafe24Line,
} from './_shared/channels/cafe24-test-fixtures.ts';

type Query = { table: string; operation: string; values: Record<string, unknown>; single: boolean };
type Result = { data?: unknown; error?: unknown };
const mocks = vi.hoisted(() => ({
    handlers: {} as Record<string, (req: Request) => Promise<Response>>,
    query: vi.fn<(query: Query) => Result>(),
    user: vi.fn(),
    access: vi.fn(),
    upsert: vi.fn(),
    capture: vi.fn(),
    adapter: {
        refreshAuth: vi.fn(),
        fetchOrdersSince: vi.fn(),
        listProducts: vi.fn(),
        testConnection: vi.fn(),
        markShipped: vi.fn(),
        capabilities: { outboundDispatch: true },
    },
}));

vi.mock('./_shared/auth.ts', () => ({
    corsHeaders: {},
    getAuthenticatedUser: mocks.user,
    resolveWorkspaceOwner: mocks.access,
    jsonResponse: (body: unknown, status = 200) => Response.json(body, { status }),
    serviceClient: () => ({
        from: (table: string) => {
            const query: Query = { table, operation: 'select', values: {}, single: false };
            const chain = {
                select: () => chain,
                eq: () => chain,
                in: () => chain,
                order: () => chain,
                limit: () => chain,
                insert: (values: Record<string, unknown>) => {
                    query.operation = 'insert';
                    query.values = values;
                    return chain;
                },
                update: (values: Record<string, unknown>) => {
                    query.operation = 'update';
                    query.values = values;
                    return chain;
                },
                single: () => {
                    query.single = true;
                    return chain;
                },
                maybeSingle: () => {
                    query.single = true;
                    return chain;
                },
                // biome-ignore lint/suspicious/noThenProperty: PostgREST query builders are awaitable.
                then: (resolve: (result: Result) => unknown) => Promise.resolve(mocks.query(query)).then(resolve),
            };
            return chain;
        },
        rpc: (table: string) => Promise.resolve(mocks.query({ table, operation: 'rpc', values: {}, single: false })),
    }),
}));
vi.mock('./_shared/sentry.ts', () => ({
    serveWithSentry: (name: string, handler: (req: Request) => Promise<Response>) => {
        mocks.handlers[name] = handler;
    },
    captureEdgeException: mocks.capture,
    respondServerError: (_name: string, message: string) => Response.json({ error: message }, { status: 500 }),
}));
vi.mock('./_shared/channels/adapters.ts', () => ({ getAdapter: () => mocks.adapter }));
vi.mock('./_shared/channels/normalize.ts', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./_shared/channels/normalize.ts')>()),
    upsertCanonicalOrders: mocks.upsert,
}));
vi.mock('./_shared/channels/run-lock.ts', () => ({
    reclaimStaleRuns: vi.fn(),
    acquireDispatchRunLock: async () => ({ ok: true, runId: 'run' }),
    releaseRunLock: vi.fn(),
}));
vi.mock('./_shared/channels/secrets-session.ts', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./_shared/channels/secrets-session.ts')>()),
    loadSecretsSession: async () => ({ current: () => ({}), rotate: vi.fn() }),
}));

const connection = {
    id: 'connection',
    user_id: 'owner',
    platform: 'cafe24',
    status: 'active',
    poll_cursor: { since: 'old' },
    consecutive_failures: 0,
    auto_fulfill_on_shipped: true,
};
const invite = {
    id: 'invite',
    user_id: 'owner',
    event_id: 'event',
    sample_id: null,
    expires_at: '2099-01-01',
    max_uses: 10,
    used_count: 0,
    revoked_at: null,
};
const order = {
    id: 'order',
    user_id: 'owner',
    platform: 'cafe24',
    connection_id: 'connection',
    platform_order_id: 'external',
    status: 'paid',
    fulfilled_at: null,
    order_lines: [{ platform_line_id: 'line', status: 'active' }],
};
const failure = { message: 'database unavailable' };

function defaultResult(query: Query): Result {
    if (query.operation !== 'select') return { data: { id: 'run' }, error: null };
    switch (query.table) {
        case 'sales_channel_connections':
            return { data: query.single ? connection : [connection] };
        case 'sales_channel_secrets':
            return { data: { credentials: {} } };
        case 'orders':
            return { data: order };
        case 'order_dispatches':
            return { data: null };
        case 'cupping_invites':
            return { data: invite };
        case 'cupping_samples':
            return { data: query.single ? { id: 'sample', event_id: 'event' } : [] };
        case 'cupping_events':
            return { data: { id: 'event', ended_at: null } };
        default:
            return { data: [] };
    }
}

beforeAll(async () => {
    await import('./order-sync/index.ts');
    await import('./order-webhook/index.ts');
    await import('./order-dispatch/index.ts');
    await import('./channel-connect/index.ts');
    await import('./channel-products/index.ts');
    await import('./get-cupping-session/index.ts');
    await import('./submit-cupping/index.ts');
});

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Deno', { env: { get: (key: string) => (key.endsWith('SECRET') ? 'shared-secret' : undefined) } });
    mocks.query.mockImplementation(defaultResult);
    mocks.user.mockResolvedValue({ id: 'member' });
    mocks.access.mockResolvedValue('owner');
    mocks.upsert.mockResolvedValue({ upserted: 1, stockEventSkips: [] });
    mocks.adapter.refreshAuth.mockResolvedValue(null);
    mocks.adapter.fetchOrdersSince.mockResolvedValue({ orders: [], nextCursor: { since: 'new' } });
    mocks.adapter.markShipped.mockResolvedValue({ ok: true, alreadyShipped: false });
    mocks.adapter.listProducts.mockResolvedValue([]);
    mocks.adapter.testConnection.mockResolvedValue({ shopIdentifier: 'shop', displayName: 'Shop' });
});

function request(name: string, body: unknown = {}, headers: Record<string, string> = {}, platform = 'cafe24') {
    return mocks.handlers[name](
        new Request(`https://example.test/${name}?platform=${platform}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
        }),
    );
}

describe('order-sync persistence and authorization', () => {
    it.each(['sales_channel_connections', 'order_sync_runs'])(
        'returns 500 when %s success persistence fails',
        async (table) => {
            mocks.query.mockImplementation((q) =>
                q.table === table && q.operation === 'update' && (q.values.poll_cursor || q.values.status === 'success')
                    ? { error: failure }
                    : defaultResult(q),
            );
            const response = await request('order-sync');
            expect(response.status).toBe(500);
            expect(await response.json()).toMatchObject({ results: [{ ok: false }] });
            expect(
                mocks.query.mock.calls.some(([q]) => q.table === 'order_sync_runs' && q.values.status === 'error'),
            ).toBe(true);
            expect(mocks.capture).toHaveBeenCalledOnce();
        },
    );

    it('accepts cron without a user JWT, and rejects a wrong secret without a user', async () => {
        mocks.user.mockResolvedValue(null);
        expect((await request('order-sync', {}, { 'x-cron-secret': 'shared-secret' })).status).toBe(200);
        expect(mocks.user).not.toHaveBeenCalled();
        expect((await request('order-sync', {}, { 'x-cron-secret': 'wrong' })).status).toBe(401);
    });
});

describe('channel errors', () => {
    it.each(['sales_channel_connections', 'sales_channel_secrets'])(
        'aborts reconnect on a %s read failure',
        async (table) => {
            mocks.query.mockImplementation((q) => (q.table === table ? { error: failure } : defaultResult(q)));
            const response = await request('channel-connect', {
                platform: 'shopify',
                credentials: { shop: 'demo', access_token: 'token' },
            });
            expect(response.status).toBe(500);
            expect(mocks.query.mock.calls.every(([q]) => q.operation === 'select')).toBe(true);
        },
    );
    it('distinguishes a connection lookup failure from a missing connection', async () => {
        mocks.query.mockReturnValue({ error: failure });
        expect((await request('channel-products', { connectionId: 'connection' })).status).toBe(500);
        mocks.query.mockReturnValue({ data: null });
        expect((await request('channel-products', { connectionId: 'connection' })).status).toBe(404);
    });

    it.each(['channel-connect', 'channel-products'])('%s never returns platform error bodies', async (name) => {
        const error = new Error('provider response with access_token=private');
        mocks.adapter.testConnection.mockRejectedValue(error);
        mocks.adapter.listProducts.mockRejectedValue(error);
        const response = await request(name, {
            connectionId: 'connection',
            platform: 'shopify',
            credentials: { shop: 'demo', access_token: 'token' },
        });
        expect(response.status).toBe(name === 'channel-connect' ? 400 : 502);
        expect(await response.text()).not.toContain('private');
    });
});

const dispatchBody = { orderId: 'order', carrier: 'cj', trackingNumber: '1234567890' };
describe('dispatch', () => {
    it.each(['order_dispatches', 'orders'])('fails if shipped result cannot be saved to %s', async (table) => {
        mocks.query.mockImplementation((q) =>
            q.table === table && q.operation === 'update' ? { error: failure } : defaultResult(q),
        );
        expect((await request('order-dispatch', dispatchBody)).status).toBe(500);
    });

    it('keeps platform success and reports a partial fulfillment failure', async () => {
        mocks.query.mockImplementation((q) => (q.table === 'fulfill_order' ? { error: failure } : defaultResult(q)));
        const response = await request('order-dispatch', dispatchBody);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ fulfilled: false, fulfillError: failure.message });
        expect(mocks.access).toHaveBeenCalledWith(expect.any(Request), 'owner', 'member');
        expect(mocks.query.mock.calls.some(([q]) => String(q.values.last_error).startsWith('fulfill:'))).toBe(true);
    });

    it('refuses dispatch when workspace access is denied', async () => {
        mocks.access.mockResolvedValue(null);
        expect((await request('order-dispatch', dispatchBody)).status).toBe(403);
        expect(mocks.adapter.markShipped).not.toHaveBeenCalled();
    });
});

describe.each(['get-cupping-session', 'submit-cupping'])('%s invite event guards', (name) => {
    it('fails closed when a legacy sample lookup fails', async () => {
        mocks.query.mockImplementation((q) => {
            if (q.table === 'cupping_invites') return { data: { ...invite, event_id: null, sample_id: 'sample' } };
            if (q.table === 'cupping_samples') return { error: failure };
            return defaultResult(q);
        });
        expect((await request(name, { token: 'invite-token', action: 'claim', cuppedBy: 'Cupper' })).status).toBe(500);
    });
    it.each([false, true])('fails closed on an event read error (legacy sample: %s)', async (legacy) => {
        mocks.query.mockImplementation((q) => {
            if (q.table === 'cupping_events') return { error: failure };
            if (q.table === 'cupping_invites' && legacy)
                return { data: { ...invite, event_id: null, sample_id: 'sample' } };
            return defaultResult(q);
        });
        expect((await request(name, { token: 'invite-token', action: 'claim', cuppedBy: 'Cupper' })).status).toBe(500);
        expect(mocks.query.mock.calls.every(([q]) => q.operation === 'select')).toBe(true);
    });

    it.each([
        [null, 404],
        [{ ended_at: '2026-01-01' }, 410],
    ])('rejects a missing or ended event', async (event, status) => {
        mocks.query.mockImplementation((q) => (q.table === 'cupping_events' ? { data: event } : defaultResult(q)));
        expect((await request(name, { token: 'invite-token', action: 'claim', cuppedBy: 'Cupper' })).status).toBe(
            status,
        );
    });
});

describe('Cafe24 webhook', () => {
    const body = {
        event_no: 90023,
        resource: {
            mall_id: 'demo',
            order_id: 'order',
            order_date: '2026-10-16T00:00:00Z',
            paid: 'T',
            items: [{ order_item_code: 'line', quantity: 1 }],
        },
    };

    it('processes the same delivery twice through the idempotent batch boundary', async () => {
        expect((await request('order-webhook', body, { 'X-API-Key': 'shared-secret' })).status).toBe(200);
        expect((await request('order-webhook', body, { 'X-API-Key': 'shared-secret' })).status).toBe(200);
        expect(mocks.upsert).toHaveBeenCalledTimes(2);
        expect(mocks.upsert.mock.calls[0][2]).toEqual(mocks.upsert.mock.calls[1][2]);
    });

    it('reports a run insert failure and rejects missing authentication', async () => {
        mocks.query.mockImplementation((q) => (q.table === 'order_sync_runs' ? { error: failure } : defaultResult(q)));
        expect((await request('order-webhook', body, { 'X-API-Key': 'shared-secret' })).status).toBe(500);
        mocks.upsert.mockClear();
        expect((await request('order-webhook', body)).status).toBe(401);
        expect(mocks.upsert).not.toHaveBeenCalled();
    });

    function mockCafe24SecretsAndFetch(detail: Record<string, unknown> | null, fetchStatus = 200) {
        mocks.query.mockImplementation((q) => {
            if (q.table === 'sales_channel_secrets') {
                return { data: { credentials: { mall_id: 'demo', access_token: 'tok' } } };
            }
            return defaultResult(q);
        });
        vi.stubGlobal('fetch', async (input: URL | string) => {
            const url = String(input);
            if (url.includes(`/orders/${CAFE24_ITEMLESS_ORDER_ID}`)) {
                if (fetchStatus !== 200 || !detail) {
                    return new Response('error', { status: fetchStatus });
                }
                return new Response(JSON.stringify({ order: detail }), { status: 200 });
            }
            return new Response('{}', { status: 404 });
        });
    }

    it('fetches order detail when the webhook omits items (#903)', async () => {
        const itemless = cafe24ItemlessWebhookPayload();
        mockCafe24SecretsAndFetch(
            cafe24ItemlessDetailOrder([
                cafe24Line('line-active', 'N20', 1, { product_name: 'A' }),
                cafe24Line('line-c40', 'C40', 1, { product_name: 'B' }),
            ]),
        );
        const response = await request('order-webhook', itemless, { 'X-API-Key': 'shared-secret' });
        expect(response.status).toBe(200);
        expect(mocks.upsert).toHaveBeenCalledOnce();
        const orders = mocks.upsert.mock.calls[0][2] as Array<{
            totalAmount: number | null;
            lines: Array<{ platformLineId: string; status: string }>;
        }>;
        expect(orders[0].totalAmount).toBe(15000);
        const lineIds = orders[0].lines.map((l) => l.platformLineId);
        expect(lineIds).toEqual(['line-active', 'line-c40']);
        expect(lineIds.some((id) => id.endsWith('-unknown'))).toBe(false);
        expect(orders[0].lines.find((l) => l.platformLineId === 'line-c40')?.status).toBe('cancelled');
        vi.unstubAllGlobals();
    });

    it('does not upsert or claim when detail fetch fails', async () => {
        const itemless = cafe24ItemlessWebhookPayload();
        mockCafe24SecretsAndFetch(null, 500);
        expect((await request('order-webhook', itemless, { 'X-API-Key': 'shared-secret' })).status).toBe(500);
        expect(mocks.upsert).not.toHaveBeenCalled();
        expect(
            mocks.query.mock.calls.some(([q]) => q.table === 'order_sync_runs' && q.operation === 'insert'),
        ).toBe(false);
        vi.unstubAllGlobals();
    });

    it('does not upsert when detail returns empty items', async () => {
        const itemless = cafe24ItemlessWebhookPayload();
        mockCafe24SecretsAndFetch(cafe24ItemlessDetailOrder([]));
        expect((await request('order-webhook', itemless, { 'X-API-Key': 'shared-secret' })).status).toBe(500);
        expect(mocks.upsert).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});

it('releases the Shopify delivery key when success-run persistence fails', async () => {
    mocks.query.mockImplementation((q) =>
        q.table === 'order_sync_runs' && q.values.status === 'success' ? { error: failure } : defaultResult(q),
    );
    const body = { id: 123, line_items: [] };
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode('shared-secret'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(body))));
    const response = await request(
        'order-webhook',
        body,
        {
            'X-Shopify-Shop-Domain': 'demo.myshopify.com',
            'X-Shopify-Topic': 'orders/create',
            'X-Shopify-Webhook-Id': 'delivery',
            'X-Shopify-Hmac-Sha256': btoa(String.fromCharCode(...signature)),
        },
        'shopify',
    );
    expect(response.status).toBe(500);
    expect(
        mocks.query.mock.calls.some(([q]) => q.values.status === 'error' && q.values.external_event_id === null),
    ).toBe(true);
    expect(mocks.capture).toHaveBeenCalledOnce();
});
