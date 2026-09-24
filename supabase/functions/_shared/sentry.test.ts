import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    captureEdgeException,
    isActionableEdgeError,
    respondServerError,
    scrubSensitive,
    serveWithSentry,
} from './sentry';

const DSN = 'https://publickey@o111.ingest.sentry.io/222';

type SentryEvent = {
    environment?: string;
    release?: string;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    exception?: { values: { type: string; value: string }[] };
};

let env: Record<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
/** Handler that serveWithSentry passed to the stubbed Deno.serve. */
let served: ((req: Request) => Promise<Response>) | null;

const sentEvent = (): SentryEvent => JSON.parse(fetchMock.mock.calls[0][1].body);

beforeEach(() => {
    env = { SENTRY_DSN: DSN };
    served = null;
    fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Deno', {
        env: { get: (key: string) => env[key] },
        serve: (handler: (req: Request) => Promise<Response>) => {
            served = handler;
        },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('isActionableEdgeError', () => {
    it('5xx and unknown status are actionable', () => {
        expect(isActionableEdgeError(500)).toBe(true);
        expect(isActionableEdgeError(502)).toBe(true);
        expect(isActionableEdgeError(undefined)).toBe(true);
    });

    it('client-fault statuses are dropped', () => {
        for (const status of [400, 401, 403, 404, 405, 410, 429]) {
            expect(isActionableEdgeError(status)).toBe(false);
        }
    });
});

describe('captureEdgeException', () => {
    it('sends a 500-class error with runtime/function/environment/release', async () => {
        env.SENTRY_ENVIRONMENT = 'staging';
        env.SENTRY_RELEASE = 'fc@1.2.3';

        await captureEdgeException(new Error('boom'), { function: 'order-sync', status: 500 });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const event = sentEvent();
        expect(event.tags).toMatchObject({ runtime: 'edge', function: 'order-sync' });
        expect(event.environment).toBe('staging');
        expect(event.release).toBe('fc@1.2.3');
        expect(event.exception?.values[0].value).toBe('boom');
    });

    it('defaults environment to production and omits release when unset', async () => {
        await captureEdgeException(new Error('boom'), { function: 'notify-signup' });

        const event = sentEvent();
        expect(event.environment).toBe('production');
        expect(event.release).toBeUndefined();
    });

    it('drops 401/403/400-style statuses', async () => {
        for (const status of [400, 401, 403, 405]) {
            await captureEdgeException(new Error('rejected'), { function: 'f', status });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is a no-op without SENTRY_DSN', async () => {
        delete env.SENTRY_DSN;
        await captureEdgeException(new Error('boom'), { status: 500 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is a no-op when Deno is absent', async () => {
        vi.stubGlobal('Deno', undefined);
        await captureEdgeException(new Error('boom'), { status: 500 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('scrubs secrets out of extra and presigned URLs out of the message', async () => {
        await captureEdgeException(
            new Error('PUT https://acc.r2.cloudflarestorage.com/k.tsv?X-Amz-Signature=deadbeef failed'),
            {
                status: 500,
                extra: {
                    headers: { authorization: 'Bearer real-jwt' },
                    creds: { access_token: 'shpat-live-value' },
                },
            },
        );

        const body = fetchMock.mock.calls[0][1].body as string;
        expect(body).not.toContain('deadbeef');
        expect(body).not.toContain('real-jwt');
        expect(body).not.toContain('shpat-live-value');
        expect(sentEvent().exception?.values[0].value).toContain('r2.cloudflarestorage.com');
    });

    it('reads the message off Supabase-style plain error objects', async () => {
        await captureEdgeException({ message: 'duplicate key value', code: '23505' }, { status: 500 });

        expect(sentEvent().exception?.values[0].value).toBe('duplicate key value');
    });

    it('never throws when the transport fails', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));
        await expect(
            captureEdgeException(new Error('boom'), { status: 500 }),
        ).resolves.toBeUndefined();
    });
});

describe('scrubSensitive', () => {
    it('redacts nested secret-ish keys and URL query strings', () => {
        expect(
            scrubSensitive({
                connection: {
                    id: 'c1',
                    credentials: { access_token: 'a', webhook_secret: 'b' },
                    Authorization: 'Bearer x',
                },
                cookie: 'sb=1',
                password: 'hunter2',
                uploadUrl: 'https://acc.r2.cloudflarestorage.com/x.tsv?X-Amz-Signature=sig&x=1',
                list: [{ refresh_token: 'r' }],
            }),
        ).toEqual({
            connection: {
                id: 'c1',
                credentials: '[redacted]',
                Authorization: '[redacted]',
            },
            cookie: '[redacted]',
            password: '[redacted]',
            uploadUrl: 'https://acc.r2.cloudflarestorage.com/x.tsv?[redacted]',
            list: [{ refresh_token: '[redacted]' }],
        });
    });

    it('leaves ordinary values alone', () => {
        expect(scrubSensitive({ platform: 'shopify', count: 3, ok: true, none: null })).toEqual({
            platform: 'shopify',
            count: 3,
            ok: true,
            none: null,
        });
    });
});

describe('serveWithSentry', () => {
    it('captures a thrown error and answers 500 without leaking the message', async () => {
        serveWithSentry('order-webhook', () => {
            throw new Error('db exploded');
        });
        const res = await served!(new Request('https://edge.test/'));

        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'Internal error' });
        expect(sentEvent().tags).toMatchObject({ runtime: 'edge', function: 'order-webhook' });
    });

    it('passes handler responses through untouched and captures nothing', async () => {
        const unauthorized = new Response('{"error":"Unauthorized"}', { status: 401 });
        serveWithSentry('order-webhook', () => unauthorized);

        expect(await served!(new Request('https://edge.test/'))).toBe(unauthorized);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still answers 500 when the Sentry transport fails', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));
        serveWithSentry('order-webhook', () => {
            throw new Error('db exploded');
        });

        expect((await served!(new Request('https://edge.test/'))).status).toBe(500);
    });
});

describe('respondServerError', () => {
    it('captures the original error and returns a 500 without leaking it', async () => {
        const res = await respondServerError('get-cupping-session', 'lookup failed', {
            message: 'relation does not exist',
        });

        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'lookup failed' });
        expect(sentEvent().tags).toMatchObject({ runtime: 'edge', function: 'get-cupping-session' });
        expect(sentEvent().exception?.values[0].value).toBe('relation does not exist');
    });

    it('still returns 500 when the transport fails', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));
        const res = await respondServerError('submit-cupping', 'insert failed');
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'insert failed' });
    });
});
