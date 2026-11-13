import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Query = {
    table: string;
    operation: string;
    values: Record<string, unknown>;
    single: boolean;
    filters: Array<[string, string, unknown]>;
};
type Result = { data?: unknown; error?: unknown };
const mocks = vi.hoisted(() => ({
    handlers: {} as Record<string, (req: Request) => Promise<Response>>,
    query: vi.fn<(query: Query) => Result | Promise<Result>>(),
    user: vi.fn(),
    access: vi.fn(),
    upsert: vi.fn(),
    capture: vi.fn(),
    loadSecrets: vi.fn(),
    rotate: vi.fn(),
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
            const query: Query = { table, operation: 'select', values: {}, single: false, filters: [] };
            const chain = {
                select: () => chain,
                eq: (column: string, value: unknown) => {
                    query.filters.push(['eq', column, value]);
                    return chain;
                },
                neq: (column: string, value: unknown) => {
                    query.filters.push(['neq', column, value]);
                    return chain;
                },
                lt: (column: string, value: unknown) => {
                    query.filters.push(['lt', column, value]);
                    return chain;
                },
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
                then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) =>
                    Promise.resolve()
                        .then(() => mocks.query(query))
                        .then(resolve, reject),
            };
            return chain;
        },
        rpc: (table: string) =>
            Promise.resolve(mocks.query({ table, operation: 'rpc', values: {}, single: false, filters: [] })),
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
vi.mock('./_shared/channels/secrets-session.ts', () => ({
    loadSecretsSession: mocks.loadSecrets,
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
    mocks.loadSecrets.mockResolvedValue({ current: () => ({}), rotate: mocks.rotate });
    mocks.rotate.mockResolvedValue(undefined);
    mocks.adapter.capabilities.outboundDispatch = true;
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

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function runQueries() {
    return mocks.query.mock.calls.map(([q]) => q).filter((q) => q.table === 'order_sync_runs');
}

function expectNoChannelWork() {
    expect(mocks.loadSecrets).not.toHaveBeenCalled();
    expect(mocks.adapter.refreshAuth).not.toHaveBeenCalled();
    expect(mocks.rotate).not.toHaveBeenCalled();
    expect(mocks.adapter.fetchOrdersSince).not.toHaveBeenCalled();
    expect(mocks.adapter.markShipped).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
}

describe.each(['order-sync', 'order-dispatch'])('%s real run lock', (name) => {
    it('awaits reclaim and acquisition before secrets, token rotation, and platform work', async () => {
        const reclaim = deferred<Result>();
        const acquire = deferred<Result>();
        const reclaimStarted = deferred<void>();
        const acquireStarted = deferred<void>();
        const events: string[] = [];
        mocks.query.mockImplementation(async (q) => {
            if (q.table === 'order_sync_runs' && q.values.error_message === 'run timed out — reclaimed') {
                reclaimStarted.resolve();
                const result = await reclaim.promise;
                events.push('reclaimed');
                return result;
            }
            if (q.table === 'order_sync_runs' && q.values.status === 'running') {
                acquireStarted.resolve();
                const result = await acquire.promise;
                events.push('acquired');
                return result;
            }
            return defaultResult(q);
        });
        mocks.loadSecrets.mockImplementation(async () => {
            events.push('secrets');
            return { current: () => ({}), rotate: mocks.rotate };
        });
        mocks.adapter.refreshAuth.mockImplementation(async () => {
            events.push('refresh');
            return { access_token: 'rotated-test-token' };
        });
        mocks.rotate.mockImplementation(async () => {
            events.push('rotated');
        });
        mocks.adapter.fetchOrdersSince.mockImplementation(async () => {
            events.push('fetch');
            return { orders: [], nextCursor: { since: 'new' } };
        });
        mocks.adapter.markShipped.mockImplementation(async () => {
            events.push('ship');
            return { ok: true, alreadyShipped: false };
        });

        const pending = request(name, dispatchBody);
        await reclaimStarted.promise;
        expect(runQueries()).toHaveLength(1);
        if (name === 'order-sync') expect(mocks.query).toHaveBeenCalledOnce();
        expect(events).toEqual([]);
        expectNoChannelWork();

        reclaim.resolve({ error: null });
        await acquireStarted.promise;
        expect(events).toEqual(['reclaimed']);
        expectNoChannelWork();
        expect(runQueries()[1].values).toEqual({
            connection_id: 'connection',
            user_id: 'owner',
            trigger: name === 'order-sync' ? 'manual' : 'dispatch',
            status: 'running',
        });

        acquire.resolve({ data: { id: 'acquired-run' }, error: null });
        const response = await pending;
        expect(response.status).toBe(200);
        expect(events).toEqual([
            'reclaimed',
            'acquired',
            'secrets',
            'refresh',
            'rotated',
            name === 'order-sync' ? 'fetch' : 'ship',
        ]);
        const finished = runQueries().filter((q) =>
            q.filters.some(([op, column, value]) => op === 'eq' && column === 'id' && value === 'acquired-run'),
        );
        expect(finished).toHaveLength(1);
        expect(finished[0].values.status).toBe('success');
        expect(mocks.capture).not.toHaveBeenCalled();
    });

    it.each([
        [{ data: null, error: { code: '23505', message: 'duplicate key' } }, 'conflict'],
        [{ data: { id: 'ignored' }, error: { code: '23505' } }, 'conflict'],
        [{ data: null, error: { code: '42501', message: 'permission denied' } }, 'permission denied'],
        [{ data: { id: 'ignored' }, error: { code: '42501' } }, 'run insert failed'],
        [{ data: null, error: null }, 'run insert failed'],
    ] as const)('preserves acquisition result %j with no external work', async (result, error) => {
        mocks.query.mockImplementation((q) => {
            if (q.table === 'order_sync_runs' && q.values.status === 'running') return result;
            // Returned skipped-audit errors have always been ignored.
            if (q.table === 'order_sync_runs' && q.values.status === 'skipped') return { error: failure };
            return defaultResult(q);
        });
        const response = await request(name, dispatchBody);
        const conflict = error === 'conflict';
        expect(response.status).toBe(conflict ? (name === 'order-sync' ? 200 : 409) : 500);
        expect(await response.json()).toEqual(
            name === 'order-sync'
                ? {
                      results: [
                          {
                              connectionId: 'connection',
                              platform: 'cafe24',
                              ok: conflict,
                              upserted: 0,
                              ...(conflict ? { skipped: true } : { error }),
                          },
                      ],
                      truncated: false,
                  }
                : { error: conflict ? 'another run in progress' : error },
        );
        expectNoChannelWork();
        expect(mocks.capture).toHaveBeenCalledTimes(name === 'order-dispatch' && !conflict ? 1 : 0);
        expect(runQueries().filter((q) => q.operation === 'update')).toHaveLength(1);
        const skipped = runQueries().filter((q) => q.values.status === 'skipped');
        expect(skipped).toHaveLength(conflict ? 1 : 0);
        if (conflict)
            expect(skipped[0].values).toEqual({
                connection_id: 'connection',
                user_id: 'owner',
                trigger: name === 'order-sync' ? 'manual' : 'dispatch',
                status: 'skipped',
                finished_at: expect.any(String),
                error_message: 'another run in progress',
            });
    });

    it.each(['reclaim', 'running', 'skipped'])(
        'propagates rejected %s writes outside acquired-run cleanup',
        async (step) => {
            const rejection = new Error(`${step} rejected`);
            mocks.query.mockImplementation((q) => {
                if (q.table === 'order_sync_runs') {
                    if (
                        (step === 'reclaim' && q.values.error_message === 'run timed out — reclaimed') ||
                        q.values.status === step
                    ) {
                        return Promise.reject(rejection);
                    }
                    if (step === 'skipped' && q.values.status === 'running')
                        return { data: null, error: { code: '23505' } };
                }
                return defaultResult(q);
            });
            await expect(request(name, dispatchBody)).rejects.toBe(rejection);
            expectNoChannelWork();
            expect(mocks.capture).not.toHaveBeenCalled();
            expect(runQueries().filter((q) => q.operation === 'update')).toHaveLength(1);
        },
    );

    it('captures a returned reclaim error once and continues acquisition', async () => {
        mocks.query.mockImplementation((q) =>
            q.table === 'order_sync_runs' && q.values.error_message === 'run timed out — reclaimed'
                ? { error: failure }
                : defaultResult(q),
        );
        expect((await request(name, dispatchBody)).status).toBe(200);
        expect(mocks.adapter.refreshAuth).toHaveBeenCalledOnce();
        expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(failure, {
            function: 'run-lock',
            status: 500,
            tags: { step: 'reclaim' },
        });
    });
});

describe('order-sync persistence and authorization', () => {
    it.each([0, 1, 2])('reclaims once for a %i-connection sweep', async (count) => {
        mocks.query.mockImplementation((q) =>
            q.table === 'sales_channel_connections' && q.operation === 'select'
                ? { data: Array.from({ length: count }, (_, i) => ({ ...connection, id: `connection-${i}` })) }
                : defaultResult(q),
        );
        const response = await request('order-sync');
        expect(response.status).toBe(200);
        expect(runQueries().filter((q) => q.values.error_message === 'run timed out — reclaimed')).toHaveLength(1);
        expect(runQueries().filter((q) => q.values.status === 'running')).toHaveLength(count);
        expect(mocks.adapter.fetchOrdersSince).toHaveBeenCalledTimes(count);
        if (count === 0) expect(await response.json()).toEqual({ results: [], message: 'no connections' });
    });

    it.each([false, true])('preserves the %s cron/manual trigger and minimal inbound context', async (cron) => {
        const response = await request('order-sync', {}, cron ? { 'x-cron-secret': 'shared-secret' } : {});
        expect(response.status).toBe(200);
        expect(runQueries().find((q) => q.values.status === 'running')?.values.trigger).toBe(cron ? 'cron' : 'manual');
        expect(mocks.upsert.mock.calls[0][1]).toEqual({
            userId: 'owner',
            connectionId: 'connection',
            platform: 'cafe24',
        });
    });

    it.each(['sales_channel_connections', 'order_sync_runs'])(
        'returns 500 when %s success persistence fails',
        async (table) => {
            mocks.query.mockImplementation((q) => {
                if (q.table === 'sales_channel_connections' && q.operation === 'select') {
                    return { data: [{ ...connection, consecutive_failures: 4 }] };
                }
                return q.table === table &&
                    q.operation === 'update' &&
                    (q.values.poll_cursor || q.values.status === 'success')
                    ? { error: failure }
                    : defaultResult(q);
            });
            const response = await request('order-sync');
            const message =
                table === 'sales_channel_connections' ? 'Failed to save poll cursor' : 'Failed to finish sync run';
            expect(response.status).toBe(500);
            expect(await response.json()).toEqual({
                results: [{ connectionId: 'connection', platform: 'cafe24', ok: false, upserted: 0, error: message }],
                truncated: false,
            });
            const runFailure = runQueries().filter(
                (q) => q.values.status === 'error' && q.filters.some(([, column]) => column === 'id'),
            );
            expect(runFailure).toHaveLength(1);
            expect(runFailure[0]).toMatchObject({
                values: { error_message: message, finished_at: expect.any(String) },
                filters: [['eq', 'id', 'run']],
            });
            expect(
                mocks.query.mock.calls.map(([q]) => q).find((q) => q.values.consecutive_failures === 5),
            ).toMatchObject({
                table: 'sales_channel_connections',
                values: { status: 'error', last_error: message, last_polled_at: expect.any(String) },
            });
            expect(mocks.capture).toHaveBeenCalledOnce();
        },
    );

    it('retains refused-stock evidence in the successful run and response', async () => {
        const stockEventSkips = [
            { referenceId: 'reference', orderId: 'order', orderStatus: 'cancelled', reason: 'terminal' },
        ];
        mocks.upsert.mockResolvedValue({ upserted: 2, stockEventSkips });
        const response = await request('order-sync');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            results: [{ connectionId: 'connection', platform: 'cafe24', ok: true, upserted: 2, stockEventSkips }],
            truncated: false,
        });
        expect(runQueries().find((q) => q.values.status === 'success')).toMatchObject({
            values: { orders_upserted: 2, error_message: `stock events skipped: ${JSON.stringify(stockEventSkips)}` },
            filters: [['eq', 'id', 'run']],
        });
    });

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
    it('captures a returned release error once while retaining the successful response', async () => {
        mocks.query.mockImplementation((q) =>
            q.table === 'order_sync_runs' && q.filters.some(([, column]) => column === 'id')
                ? { error: failure }
                : defaultResult(q),
        );
        expect((await request('order-dispatch', dispatchBody)).status).toBe(200);
        expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(failure, {
            function: 'run-lock',
            status: 500,
            tags: { step: 'release' },
        });
    });

    it.each(['unauthorized', 'forbidden', 'manual', 'disconnected', 'already dispatched'])(
        'returns before reclaim/acquire when %s',
        async (scenario) => {
            if (scenario === 'unauthorized') mocks.user.mockResolvedValue(null);
            if (scenario === 'forbidden') mocks.access.mockResolvedValue(null);
            mocks.query.mockImplementation((q) => {
                if (q.table === 'orders' && scenario === 'manual') return { data: { ...order, platform: 'manual' } };
                if (q.table === 'orders' && scenario === 'disconnected')
                    return { data: { ...order, connection_id: null } };
                if (q.table === 'order_dispatches' && scenario === 'already dispatched')
                    return { data: { id: 'dispatch', status: 'sent' } };
                return defaultResult(q);
            });
            const response = await request('order-dispatch', dispatchBody);
            expect(response.status).toBe(
                { unauthorized: 401, forbidden: 403, manual: 400, disconnected: 400, 'already dispatched': 409 }[
                    scenario
                ],
            );
            expect(runQueries()).toEqual([]);
            expectNoChannelWork();
        },
    );

    it.each([
        ['prepare', 500, 'Failed to create dispatch'],
        ['secrets', 400, 'secrets not found'],
        ['unsupported', 400, 'platform does not support outbound dispatch'],
        ['empty lines', 400, 'no active lines'],
        ['throw', 500, 'shipping threw'],
        ['platform failure', 502, 'shipping refused'],
    ] as const)('releases once after acquired %s failure', async (scenario, status, errorMessage) => {
        mocks.query.mockImplementation((q) => {
            if (q.table === 'order_dispatches' && q.operation === 'insert' && scenario === 'prepare')
                return { error: failure };
            if (q.table === 'orders' && q.operation === 'select' && scenario === 'empty lines')
                return { data: { ...order, order_lines: [] } };
            return defaultResult(q);
        });
        if (scenario === 'secrets') mocks.loadSecrets.mockRejectedValue(new Error('missing'));
        if (scenario === 'unsupported') mocks.adapter.capabilities.outboundDispatch = false;
        if (scenario === 'throw') mocks.adapter.markShipped.mockRejectedValue(new Error(errorMessage));
        if (scenario === 'platform failure')
            mocks.adapter.markShipped.mockResolvedValue({ ok: false, error: errorMessage });
        const response = await request('order-dispatch', dispatchBody);
        expect(response.status).toBe(status);
        const releases = runQueries().filter((q) => q.filters.some(([, column]) => column === 'id'));
        expect(releases).toHaveLength(1);
        expect(releases[0]).toMatchObject({
            values: { status: 'error', error_message: errorMessage, finished_at: expect.any(String) },
            filters: [['eq', 'id', 'run']],
        });
        expect(mocks.capture).toHaveBeenCalledTimes(
            ['prepare', 'throw', 'platform failure'].includes(scenario) ? 1 : 0,
        );
    });

    it.each([false, true])(
        'retains the live dispatch auto-fulfill flag %s and releases success once',
        async (enabled) => {
            mocks.query.mockImplementation((q) =>
                q.table === 'sales_channel_connections'
                    ? { data: { ...connection, auto_fulfill_on_shipped: enabled } }
                    : defaultResult(q),
            );
            const response = await request('order-dispatch', dispatchBody);
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
                status: 'sent',
                alreadyShipped: false,
                lineResults: [],
                fulfilled: enabled,
                fulfillError: null,
            });
            expect(mocks.query.mock.calls.filter(([q]) => q.table === 'fulfill_order')).toHaveLength(enabled ? 1 : 0);
            const releases = runQueries().filter((q) => q.filters.some(([, column]) => column === 'id'));
            expect(releases).toHaveLength(1);
            expect(releases[0].values).toEqual({ status: 'success', finished_at: expect.any(String) });
        },
    );

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
        const releases = runQueries().filter((q) => q.filters.some(([, column]) => column === 'id'));
        expect(releases).toHaveLength(1);
        expect(releases[0].values.status).toBe('success');
        expect(mocks.capture).toHaveBeenCalledOnce();
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
        expect(mocks.upsert.mock.calls[0][1]).toEqual({
            userId: 'owner',
            connectionId: 'connection',
            platform: 'cafe24',
        });
        expect(runQueries().some((q) => q.values.error_message === 'run timed out — reclaimed')).toBe(false);
    });

    it('reports a run insert failure and rejects missing authentication', async () => {
        mocks.query.mockImplementation((q) => (q.table === 'order_sync_runs' ? { error: failure } : defaultResult(q)));
        expect((await request('order-webhook', body, { 'X-API-Key': 'shared-secret' })).status).toBe(500);
        mocks.upsert.mockClear();
        expect((await request('order-webhook', body)).status).toBe(401);
        expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it('returns 409 when another worker holds a fresh running claim', async () => {
        mocks.query.mockImplementation((q) => {
            if (q.table === 'order_sync_runs' && q.operation === 'insert') {
                return { data: null, error: { code: '23505', message: 'duplicate key' } };
            }
            if (q.table === 'order_sync_runs' && q.operation === 'select') {
                return {
                    data: {
                        id: 'run-live',
                        status: 'running',
                        started_at: new Date().toISOString(),
                    },
                };
            }
            return defaultResult(q);
        });
        const response = await request('order-webhook', body, { 'X-API-Key': 'shared-secret' });
        expect(response.status).toBe(409);
        expect(mocks.upsert).not.toHaveBeenCalled();
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
    expect(mocks.upsert.mock.calls[0][1]).toEqual({ userId: 'owner', connectionId: 'connection', platform: 'shopify' });
    expect(runQueries().some((q) => q.values.error_message === 'run timed out — reclaimed')).toBe(false);
});
