import * as Sentry from '@sentry/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchLimitError } from './features/plan-matrix';
import {
    buildSentryOptions,
    captureActionable,
    captureDoorSettingsPushFailure,
    captureDoorSkipped,
    captureDoorWriteNoResponse,
    captureRoastingImportFailure,
    captureSidecarRequestFailure,
    isActionableError,
    isClientRefusal,
    isExpectedRefusal,
    isSentryEnabled,
    normalizeSupabaseError,
    observeRoastingImportScan,
    reactRootOptions,
    reportReactQueryError,
    reportTsvRestoreDroppedRows,
    resetDoorSkippedDedupeForTests,
    resetRoastingImportScanDedupeForTests,
    resetSidecarFailureRateLimitForTests,
    retryUnlessClientRefusal,
    SupabaseError,
    scrubSensitive,
    scrubText,
    setSentryIdentity,
    tagsFromQueryMeta,
} from './sentry';
import { SidecarHttpError } from './sidecar';

// 실 SDK 호출을 막고 위임만 관찰한다 (개발자 로컬 .env가 테스트에 새어도 전송되지 않는다).
vi.mock('@sentry/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sentry/react')>();
    return {
        ...actual,
        init: vi.fn(),
        captureException: vi.fn(),
        captureMessage: vi.fn(),
        addBreadcrumb: vi.fn(),
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

    it('drops transient transport failures (FC-16, FC-1H, FC-1J, FC-1K)', () => {
        expect(isActionableError(new TypeError('Load failed'))).toBe(false);
        expect(isActionableError(new TypeError('Failed to fetch'))).toBe(false);
        expect(
            isActionableError({
                code: '',
                hint: '',
                message: 'TypeError: Failed to fetch (example.supabase.co)',
                details: 'TypeError: Failed to fetch\n    at fetchCoffeeFutures',
            }),
        ).toBe(false);
        expect(
            isActionableError(new Error('error sending request for url (https://cdn.example/releases/latest.json)')),
        ).toBe(false);
    });

    it('drops expected Tauri ACL denials for the removed dialog confirm command (FC-S)', () => {
        expect(isActionableError('Command plugin:dialog|confirm not allowed by ACL')).toBe(false);
    });

    it('drops deterministic PostgREST errors that have no HTTP status (42703)', () => {
        const missingColumn = {
            code: '42703',
            message: 'column roast_sessions_1.heater_events does not exist',
            details: null,
            hint: null,
        };
        expect(isClientRefusal(missingColumn)).toBe(true);
        expect(isExpectedRefusal(missingColumn)).toBe(false);
        expect(isActionableError(missingColumn)).toBe(true);
        expect(retryUnlessClientRefusal(0, missingColumn)).toBe(false);
        expect(retryUnlessClientRefusal(1, missingColumn)).toBe(false);
        expect(isClientRefusal({ code: '23505', message: 'duplicate key value' })).toBe(true);
        expect(isClientRefusal({ code: '22P02', message: 'invalid input syntax' })).toBe(true);
    });

    it('keeps real TypeErrors and server failures', () => {
        expect(isActionableError(new TypeError("Cannot read properties of undefined (reading 'bt')"))).toBe(true);
        expect(isActionableError(new Error('new row violates row-level security policy'))).toBe(true);
    });
});

describe('retryUnlessClientRefusal', () => {
    const client = () =>
        new QueryClient({
            defaultOptions: { queries: { retry: retryUnlessClientRefusal, retryDelay: 0 } },
        });

    it('does not repeat a status-less 42703, and still repeats transport and 5xx', async () => {
        const missingColumn = {
            code: '42703',
            message: 'column roast_sessions_1.heater_events does not exist',
        };
        let schemaCalls = 0;
        const schemaClient = client();
        await expect(
            schemaClient.fetchQuery({
                queryKey: ['schema'],
                queryFn: async () => {
                    schemaCalls += 1;
                    throw missingColumn;
                },
            }),
        ).rejects.toMatchObject({ code: '42703' });
        expect(schemaCalls).toBe(1);

        let transportCalls = 0;
        const transportClient = client();
        await expect(
            transportClient.fetchQuery({
                queryKey: ['transport'],
                queryFn: async () => {
                    transportCalls += 1;
                    throw new TypeError('Failed to fetch');
                },
            }),
        ).rejects.toThrow('Failed to fetch');
        expect(transportCalls).toBe(3);

        let serverCalls = 0;
        const serverClient = client();
        await expect(
            serverClient.fetchQuery({
                queryKey: ['server'],
                queryFn: async () => {
                    serverCalls += 1;
                    throw { status: 503, message: 'upstream unavailable' };
                },
            }),
        ).rejects.toMatchObject({ status: 503 });
        expect(serverCalls).toBe(3);

        expect(retryUnlessClientRefusal(0, { code: '08006', message: 'connection failure' })).toBe(true);
        expect(retryUnlessClientRefusal(0, { status: 500 })).toBe(true);
        expect(retryUnlessClientRefusal(2, { status: 500 })).toBe(false);
        expect(retryUnlessClientRefusal(0, { status: 400 })).toBe(false);
    });
});

describe('captureActionable', () => {
    it('sanitizes user-input SQLSTATE titles (22xxx)', () => {
        captureActionable(
            { code: '22P02', message: 'invalid input syntax for type uuid: "user-typed"', details: 'x', hint: 'y' },
            { tags: { feature: 'history-qc', rpc: 'set_session_charge_weight' } },
        );
        const [captured] = vi.mocked(Sentry.captureException).mock.calls[0];
        expect(captured).toMatchObject({
            name: 'SupabaseError',
            message: 'SupabaseError 22P02 set_session_charge_weight',
            code: '22P02',
        });
        expect(String(captured)).not.toContain('user-typed');
    });

    it('normalizes PostgREST plain objects before capture', () => {
        const plain = {
            code: '42703',
            message: 'column x does not exist',
            details: 'table=roast_sessions path=/secret',
            hint: 'maybe you meant y',
        };
        captureActionable(plain, { tags: { feature: 'history-qc', table: 'roast_sessions' } });
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const [captured, hint] = vi.mocked(Sentry.captureException).mock.calls[0];
        expect(captured).toBeInstanceOf(SupabaseError);
        expect((captured as SupabaseError).code).toBe('42703');
        expect(hint).toMatchObject({
            level: 'warning',
            tags: { feature: 'history-qc', table: 'roast_sessions', 'db.code': '42703' },
            fingerprint: ['supabase', '42703', 'roast_sessions'],
        });
        const blob = JSON.stringify(hint);
        expect(blob).not.toContain('/secret');
        expect(blob).not.toContain('details');
    });

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
        captureActionable(new TypeError('Load failed'));
        captureActionable({ message: 'TypeError: Failed to fetch (example.supabase.co)' });
        captureActionable(new Error('error sending request for url (https://cdn.example/releases/latest.json)'));
        captureActionable('Command plugin:dialog|confirm not allowed by ACL');
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('skips duplicate sidecar failures already reported from request()', () => {
        const err = Object.assign(new Error('sidecar'), { sentryReported: true });
        captureActionable(err);
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });
});

describe('observeRoastingImportScan', () => {
    afterEach(() => resetRoastingImportScanDedupeForTests());

    it('ignores unsupported platform scans', () => {
        observeRoastingImportScan({
            status: 'unsupported',
            reason: 'platform',
            source: { product: 'Firescope', version: null },
        });
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('captures once per product+reason and scrubs unknown reasons', () => {
        observeRoastingImportScan({
            status: 'unreadable',
            reason: 'settings-unreadable',
            source: { product: 'Artisan', version: '2.10.0' },
        });
        observeRoastingImportScan({
            status: 'unreadable',
            reason: 'settings-unreadable',
            source: { product: 'Artisan', version: '2.10.0' },
        });
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        expect(Sentry.captureMessage).toHaveBeenCalledWith('roasting import scan', {
            level: 'warning',
            fingerprint: ['roasting-import-scan', 'Artisan', 'unreadable', 'settings-unreadable'],
            tags: {
                feature: 'roasting-import',
                product: 'Artisan',
                status: 'unreadable',
                reason: 'settings-unreadable',
                'source.version': '2.10.0',
            },
        });
        observeRoastingImportScan({
            status: 'unsupported',
            reason: 'not-in-rust-whitelist',
            source: { product: 'Cropster', version: 'bad/version' },
        });
        expect(Sentry.captureMessage).toHaveBeenLastCalledWith('roasting import scan', {
            level: 'info',
            fingerprint: ['roasting-import-scan', 'Cropster', 'unsupported', 'other'],
            tags: expect.objectContaining({ reason: 'other', 'source.version': 'other' }),
        });
    });
});

describe('reportTsvRestoreDroppedRows', () => {
    it('adds one breadcrumb and one warning per parse call', () => {
        reportTsvRestoreDroppedRows(2);
        expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
        expect(Sentry.captureMessage).toHaveBeenCalledWith('tsv restore dropped extra readings', {
            level: 'warning',
            fingerprint: ['tsv-restore'],
            tags: { feature: 'tsv-restore' },
            extra: { dropped_rows: 2 },
        });
        const blob = JSON.stringify(vi.mocked(Sentry.captureMessage).mock.calls[0]);
        expect(blob).not.toMatch(/\d{1,3}(?:\.\d{1,3}){3}/);
    });
});

describe('door-control capture helpers', () => {
    afterEach(() => resetDoorSkippedDedupeForTests());

    it('captureDoorSettingsPushFailure tags settings push without paths', () => {
        captureDoorSettingsPushFailure({ name: 'SidecarHttpError', status: 503, message: '/dev/ttyUSB0' });
        expect(Sentry.captureMessage).toHaveBeenCalledWith('door.settings-push failed', {
            level: 'error',
            fingerprint: ['door', 'settings-push', 'settings', '503'],
            tags: { feature: 'door-control', op: 'settings-push', 'http.status': '503' },
        });
        const blob = JSON.stringify(vi.mocked(Sentry.captureMessage).mock.calls[0]);
        expect(blob).not.toContain('/dev/');
    });

    it('captureDoorSkipped dedupes per door per session', () => {
        captureDoorSkipped('discharge', 'link-unsettled');
        captureDoorSkipped('discharge', 'not-entitled');
        captureDoorSkipped('fill', 'door-not-armed');
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
        expect(Sentry.captureMessage).toHaveBeenCalledWith('door.skipped', {
            level: 'warning',
            fingerprint: ['door', 'skipped', 'discharge', 'link-unsettled'],
            tags: { feature: 'door-control', door: 'discharge', reason: 'link-unsettled' },
        });
    });

    it('uses distinct fingerprints so Sentry dedupe does not merge different door events', () => {
        captureDoorSkipped('discharge', 'link-unsettled');
        captureDoorWriteNoResponse({ door: 'fill', action: 'open', status: 'network' });
        captureDoorSettingsPushFailure({ name: 'SidecarHttpError', status: 503, message: 'x' });
        const fingerprints = vi
            .mocked(Sentry.captureMessage)
            .mock.calls.map((call) => (call[1] as { fingerprint?: string[] }).fingerprint);
        expect(fingerprints).toEqual([
            ['door', 'skipped', 'discharge', 'link-unsettled'],
            ['door', 'no-response', 'fill', 'open'],
            ['door', 'settings-push', 'settings', '503'],
        ]);
        expect(new Set(fingerprints.map((fp) => JSON.stringify(fp)))).toHaveProperty('size', 3);
    });

    it('captureDoorWriteNoResponse uses warning on timeout and error on network', () => {
        captureDoorWriteNoResponse({ door: 'fill', action: 'close', status: 'timeout' });
        expect(Sentry.captureMessage).toHaveBeenLastCalledWith('door.write no-response', {
            level: 'warning',
            fingerprint: ['door', 'no-response', 'fill', 'close'],
            tags: {
                feature: 'door-control',
                door: 'fill',
                action: 'close',
                reason: 'no-response',
            },
        });
        captureDoorWriteNoResponse({ door: 'discharge', action: 'open', status: 'network' });
        expect(Sentry.captureMessage).toHaveBeenLastCalledWith('door.write no-response', {
            level: 'error',
            fingerprint: ['door', 'no-response', 'discharge', 'open'],
            tags: {
                feature: 'door-control',
                door: 'discharge',
                action: 'open',
                reason: 'no-response',
            },
        });
    });

    it('captureDoorSettingsPushFailure ignores expected 409 target races', () => {
        captureDoorSettingsPushFailure({ name: 'SidecarHttpError', status: 409, message: 'target' });
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });
});

describe('captureSidecarRequestFailure', () => {
    afterEach(() => {
        resetSidecarFailureRateLimitForTests();
        vi.useRealTimers();
    });

    it('rate-limits all reported failures per route and status', () => {
        captureSidecarRequestFailure({ route: '/temperatures', method: 'GET', status: 'network' });
        captureSidecarRequestFailure({ route: '/temperatures', method: 'GET', status: 'network' });
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        captureSidecarRequestFailure({ route: '/temperatures', method: 'GET', status: 'timeout' });
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
        captureSidecarRequestFailure({ route: '/control', method: 'POST', status: 503 });
        captureSidecarRequestFailure({ route: '/control', method: 'POST', status: 503 });
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(3);
    });

    it('rate-limits alternating 5xx routes within 60s to one event per route:status', () => {
        captureSidecarRequestFailure({ route: '/status', method: 'GET', status: 500 });
        captureSidecarRequestFailure({ route: '/temperatures', method: 'GET', status: 500 });
        captureSidecarRequestFailure({ route: '/status', method: 'GET', status: 500 });
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    });

    it('resends the same route:status after the 60s window', () => {
        vi.useFakeTimers();
        captureSidecarRequestFailure({ route: '/status', method: 'GET', status: 500 });
        captureSidecarRequestFailure({ route: '/status', method: 'GET', status: 500 });
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(60_000);
        captureSidecarRequestFailure({ route: '/status', method: 'GET', status: 500 });
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    });

    it('uses a fixed message, fingerprint, and route tags only', () => {
        captureSidecarRequestFailure({ route: '/control', method: 'POST', status: 503 });
        expect(Sentry.captureMessage).toHaveBeenCalledWith('sidecar request failed', {
            level: 'error',
            fingerprint: ['sidecar', '/control', '503'],
            tags: {
                feature: 'sidecar',
                'sidecar.route': '/control',
                'http.status': '503',
                method: 'POST',
            },
        });
    });
});

describe('captureRoastingImportFailure', () => {
    it('captures only the error class name', () => {
        captureRoastingImportFailure(new Error('failed /Users/secret'), {
            product: 'Artisan',
            stage: 'graph',
            counts: { selected: 0, pending: 0, updates: 0 },
        });
        const [captured] = vi.mocked(Sentry.captureException).mock.calls[0];
        expect(captured).toMatchObject({ name: 'Error', message: 'Error' });
    });

    it('uses error.name for non-Error failures', () => {
        captureRoastingImportFailure(new TypeError('not a roast file'), {
            product: 'Cropster',
            stage: 'machines',
            counts: { selected: 1, pending: 0, updates: 2 },
        });
        const calls = vi.mocked(Sentry.captureException).mock.calls;
        const [captured] = calls[calls.length - 1];
        expect(captured).toMatchObject({ name: 'TypeError', message: 'TypeError' });
    });

    it('sets a stable roasting-import fingerprint', () => {
        captureRoastingImportFailure(new Error('x'), {
            product: 'Artisan',
            stage: 'graph',
            counts: { selected: 0, pending: 0, updates: 0 },
        });
        const calls = vi.mocked(Sentry.captureException).mock.calls;
        const [, hint] = calls[calls.length - 1] as [unknown, { fingerprint?: string[] }];
        expect(hint.fingerprint).toEqual(['roasting-import', 'Artisan', 'graph']);
    });
});

describe('normalizeSupabaseError', () => {
    it('leaves real Error instances untouched', () => {
        const err = new Error('boom');
        expect(normalizeSupabaseError(err)).toBe(err);
    });
});

describe('reportReactQueryError', () => {
    it('skips 502 SidecarHttpError so React Query does not double-report', () => {
        const err = Object.assign(new Error('plc write failed'), {
            name: 'SidecarHttpError',
            status: 502,
            sentryReported: false,
        });
        reportReactQueryError(err);
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });
});

describe('tagsFromQueryMeta', () => {
    it('maps feature, rpc, and table', () => {
        expect(tagsFromQueryMeta({ feature: 'plan-batch', rpc: 'reorder_plan_batches' })).toEqual({
            feature: 'plan-batch',
            rpc: 'reorder_plan_batches',
        });
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

describe('scrubText', () => {
    it('redacts home paths and IPv4 hosts', () => {
        expect(scrubText('failed /Users/alice/roast/settings on 192.168.0.5:502')).toBe(
            'failed [redacted] on [redacted]',
        );
        expect(scrubText('C:\\Users\\bob\\AppData\\settings')).toBe('[redacted]');
    });
});

describe('isClientRefusal sidecar retry parity', () => {
    it('does not treat SidecarHttpError 4xx as non-retryable client refusal', () => {
        const err = new SidecarHttpError('/control', 409, 'conflict');
        expect(isClientRefusal(err)).toBe(false);
        expect(retryUnlessClientRefusal(0, err)).toBe(true);
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
        expect(
            beforeSend({ type: undefined, extra: {} }, { originalException: new TypeError('Failed to fetch') }),
        ).toBeNull();
        expect(
            beforeSend(
                {
                    type: undefined,
                    extra: {},
                    exception: {
                        values: [
                            { type: 'UnhandledRejection', value: 'Command plugin:dialog|confirm not allowed by ACL' },
                        ],
                    },
                },
                {},
            ),
        ).toBeNull();
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
