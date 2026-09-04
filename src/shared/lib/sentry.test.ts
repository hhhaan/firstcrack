import * as Sentry from '@sentry/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchLimitError } from './features/plan-matrix';
import {
    buildSentryOptions,
    captureActionable,
    isActionableError,
    isSentryEnabled,
    reactRootOptions,
    scrubSensitive,
    setSentryIdentity,
} from './sentry';

// 실 SDK 호출을 막고 위임만 관찰한다 (개발자 로컬 .env가 테스트에 새어도 전송되지 않는다).
vi.mock('@sentry/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sentry/react')>();
    return {
        ...actual,
        init: vi.fn(),
        captureException: vi.fn(),
        setUser: vi.fn(),
        setTag: vi.fn(),
        setContext: vi.fn(),
    };
});

// 모듈 평가(=import) 시점에 init이 불렸는지 본다. clearAllMocks 이후에는 관찰할 수 없으므로 여기서 고정.
const initCallsOnImport = vi.mocked(Sentry.init).mock.calls.length;

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('initialization', () => {
    it('never initializes the real SDK under vitest', () => {
        expect(initCallsOnImport).toBe(0);
        expect(isSentryEnabled).toBe(false);
    });
});

describe('isActionableError', () => {
    it('captures plain errors and unknown throwables', () => {
        expect(isActionableError(new Error('boom'))).toBe(true);
        expect(isActionableError('boom')).toBe(true);
        expect(isActionableError(undefined)).toBe(true);
    });

    it('drops aborts (user navigated away / request cancelled)', () => {
        const abort = new Error('cancelled');
        abort.name = 'AbortError';
        expect(isActionableError(abort)).toBe(false);
        expect(isActionableError(new DOMException('cancelled', 'AbortError'))).toBe(false);
    });

    it('drops 4xx except 429 — rate limits are operational', () => {
        expect(isActionableError({ status: 400 })).toBe(false);
        expect(isActionableError({ status: 404 })).toBe(false);
        expect(isActionableError({ response: { status: 403 } })).toBe(false);
        expect(isActionableError({ status: 429 })).toBe(true);
        expect(isActionableError({ response: { status: 429 } })).toBe(true);
        expect(isActionableError({ status: 500 })).toBe(true);
        expect(isActionableError({ status: '404' })).toBe(true);
    });

    it('drops plan-gate refusals that supabase-js surfaces without HTTP status', () => {
        expect(isActionableError({ code: '23514', message: 'read_only_plan', details: 'table=roast_day_plans' })).toBe(
            false,
        );
        expect(isActionableError({ message: 'trial_expired' })).toBe(false);
        expect(isActionableError(new BatchLimitError(0, 0, 'read_only_plan'))).toBe(false);
    });
});

describe('captureActionable', () => {
    it('delegates actionable errors to the SDK, with context as extra', () => {
        const error = new Error('boom');
        captureActionable(error, { roastId: 3 });
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        expect(Sentry.captureException).toHaveBeenCalledWith(error, { extra: { roastId: 3 } });
    });

    it('omits the hint when no context is given', () => {
        const error = new Error('boom');
        captureActionable(error);
        expect(Sentry.captureException).toHaveBeenCalledWith(error, undefined);
    });

    it('filters non-actionable errors before they reach the SDK', () => {
        captureActionable({ status: 404 });
        const abort = new Error('cancelled');
        abort.name = 'AbortError';
        captureActionable(abort);
        captureActionable({ code: '23514', message: 'read_only_plan' });
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });
});

describe('setSentryIdentity', () => {
    it('sets id-only user plus workspace tag and context', () => {
        setSentryIdentity('user-1', 'ws-1');
        expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-1' });
        expect(Sentry.setTag).toHaveBeenCalledWith('workspace.id', 'ws-1');
        expect(Sentry.setContext).toHaveBeenCalledWith('workspace', { id: 'ws-1' });
    });

    it('clears identity on logout / missing workspace so it cannot leak to the next user', () => {
        setSentryIdentity(undefined, undefined);
        expect(Sentry.setUser).toHaveBeenCalledWith(null);
        expect(Sentry.setTag).toHaveBeenCalledWith('workspace.id', undefined);
        expect(Sentry.setContext).toHaveBeenCalledWith('workspace', null);
    });

    it('clears the workspace while a user is still signed in', () => {
        setSentryIdentity('user-1', null);
        expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-1' });
        expect(Sentry.setContext).toHaveBeenCalledWith('workspace', null);
    });
});

describe('reactRootOptions', () => {
    it('passes no custom handlers while Sentry is disabled, keeping React console reporting', () => {
        expect(reactRootOptions()).toBeUndefined();
    });

    it('marks caught/recoverable errors handled and leaves uncaught unhandled', async () => {
        vi.stubEnv('VITE_SENTRY_SMOKE', 'true');
        vi.resetModules();
        const enabled = await import('./sentry');
        expect(enabled.isSentryEnabled).toBe(true);

        // reactErrorHandler는 콜백 유무로 mechanism.handled를 정한다 — 콜백이 오는 핸들러가 handled=true.
        const handled: string[] = [];
        const options = enabled.reactRootOptions((error) => handled.push(String(error)));
        if (!options) throw new Error('handlers must be installed while Sentry is enabled');

        const info = { componentStack: 'at App' };
        options.onCaughtError(new Error('caught'), info);
        options.onRecoverableError(new Error('recoverable'), info);
        options.onUncaughtError(new Error('uncaught'), info);

        expect(handled).toEqual(['Error: caught', 'Error: recoverable']);
    });
});

describe('scrubSensitive', () => {
    it('redacts sensitive keys at any depth, case-insensitively', () => {
        expect(
            scrubSensitive({
                Authorization: 'Bearer abc',
                nested: { access_token: 'x', deep: { API_SECRET: 'y', Cookie: 'z', password: 'p' } },
            }),
        ).toEqual({
            Authorization: '[redacted]',
            nested: {
                access_token: '[redacted]',
                deep: { API_SECRET: '[redacted]', Cookie: '[redacted]', password: '[redacted]' },
            },
        });
    });

    it('redacts connection identity keys', () => {
        expect(scrubSensitive({ host: '192.168.0.5', comPort: 'COM3', serial: 'SN-1', path: '/dev/tty.usb' })).toEqual({
            host: '[redacted]',
            comPort: '[redacted]',
            serial: '[redacted]',
            path: '[redacted]',
        });
    });

    it('redacts URL query strings but keeps the endpoint', () => {
        expect(scrubSensitive('failed GET https://api.example.com/v1/roasts?token=abc&id=1')).toBe(
            'failed GET https://api.example.com/v1/roasts?[redacted]',
        );
        expect(scrubSensitive({ url: 'https://api.example.com/x?a=1' })).toEqual({
            url: 'https://api.example.com/x?[redacted]',
        });
    });

    it('stops URL redaction at punctuation instead of eating the rest of the text', () => {
        expect(scrubSensitive('{"url":"https://api.dev/x?a=1","retry":2}')).toBe(
            '{"url":"https://api.dev/x?[redacted]","retry":2}',
        );
        expect(scrubSensitive('sync failed (https://api.dev/x?a=1), retrying')).toBe(
            'sync failed (https://api.dev/x?[redacted]), retrying',
        );
        expect(scrubSensitive('GET https://api.dev/x?a=1 returned 500')).toBe(
            'GET https://api.dev/x?[redacted] returned 500',
        );
    });

    it('redacts secret/connection assignments inside free-form text, keeping the rest', () => {
        expect(scrubSensitive('modbus connect failed host=192.168.0.5 port=502')).toBe(
            'modbus connect failed host=[redacted] port=502',
        );
        expect(scrubSensitive('refresh failed: {"access_token":"a.b.c","expires_in":3600}')).toBe(
            'refresh failed: {"access_token":"[redacted]","expires_in":3600}',
        );
        expect(scrubSensitive('Authorization: Bearer abc.123 rejected')).toBe('Authorization: [redacted] rejected');
    });

    it('preserves non-sensitive context, including arrays and primitives', () => {
        expect(scrubSensitive({ roastId: 12, tags: ['a', 'b'], nested: [{ beanName: 'Yirga' }], ok: true })).toEqual({
            roastId: 12,
            tags: ['a', 'b'],
            nested: [{ beanName: 'Yirga' }],
            ok: true,
        });
    });

    it('survives cyclic objects', () => {
        const cyclic: Record<string, unknown> = { a: 1 };
        cyclic.self = cyclic;
        expect(() => scrubSensitive(cyclic)).not.toThrow();
    });
});

describe('buildSentryOptions', () => {
    it('pins release, environment, runtime tag and trace sampling', () => {
        const options = buildSentryOptions();
        expect(options.release).toMatch(/^first-crack@\d+\.\d+\.\d+$/);
        expect(options.environment).toBe(import.meta.env.PROD ? 'production' : 'development');
        expect(options.tracesSampleRate).toBe(0.1);
        expect(options.initialScope).toEqual({ tags: { runtime: 'webview' } });
    });

    it('beforeSend drops non-actionable events', () => {
        const { beforeSend } = buildSentryOptions();
        expect(beforeSend({ type: undefined, extra: {} }, { originalException: { status: 404 } })).toBeNull();
    });

    it('beforeSend scrubs message, exception values, request and breadcrumbs', () => {
        const { beforeSend } = buildSentryOptions();

        const scrubbed = beforeSend(
            {
                type: undefined,
                message: 'connect failed host=10.0.0.2 attempt=3',
                exception: { values: [{ type: 'Error', value: 'GET https://api.dev/v1?token=t failed' }] },
                request: {
                    url: 'https://api.dev/v1?token=t',
                    headers: { Authorization: 'Bearer z', 'X-Trace': 'keep-me' },
                    data: { cookie: 'sid=1', roastId: 3 },
                },
                breadcrumbs: [{ category: 'fetch', message: 'token=abc', data: { url: 'https://api.dev/v1?a=1' } }],
                extra: { token: 'abc', roastId: 3 },
            },
            { originalException: new Error('boom') },
        );

        if (!scrubbed) throw new Error('actionable events must survive beforeSend');
        expect(scrubbed.message).toBe('connect failed host=[redacted] attempt=3');
        expect(scrubbed.exception?.values?.[0]?.value).toBe('GET https://api.dev/v1?[redacted] failed');
        expect(scrubbed.request?.url).toBe('https://api.dev/v1?[redacted]');
        expect(scrubbed.request?.headers).toEqual({ Authorization: '[redacted]', 'X-Trace': 'keep-me' });
        expect(scrubbed.request?.data).toEqual({ cookie: '[redacted]', roastId: 3 });
        expect(scrubbed.breadcrumbs?.[0]).toEqual({
            category: 'fetch',
            message: 'token=[redacted]',
            data: { url: 'https://api.dev/v1?[redacted]' },
        });
        expect(scrubbed.extra).toEqual({ token: '[redacted]', roastId: 3 });
    });

    it('beforeBreadcrumb scrubs breadcrumb data', () => {
        const { beforeBreadcrumb } = buildSentryOptions();

        expect(
            beforeBreadcrumb({ category: 'fetch', data: { url: 'https://x.dev/a?k=v', authorization: 'Bearer z' } }),
        ).toEqual({
            category: 'fetch',
            data: { url: 'https://x.dev/a?[redacted]', authorization: '[redacted]' },
        });
    });
});
