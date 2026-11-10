import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockResolvedValue('test-token'),
}));

const { captureSidecar, captureReady } = vi.hoisted(() => ({ captureSidecar: vi.fn(), captureReady: vi.fn() }));
vi.mock('./sentry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./sentry')>();
    return {
        ...actual,
        captureSidecarRequestFailure: captureSidecar,
        captureSidecarReadinessFailure: captureReady,
        isSentryEnabled: true,
    };
});

let { SidecarHttpError, sidecar, subscribeSidecarSettings } = await import('./sidecar');
let { registerHopperOpenGuard } = await import('./hopperOpenGuard');

describe('sidecar.waitUntilReady', () => {
    beforeEach(async () => {
        vi.resetModules();
        ({ SidecarHttpError, sidecar, subscribeSidecarSettings } = await import('./sidecar'));
        ({ registerHopperOpenGuard } = await import('./hopperOpenGuard'));
        registerHopperOpenGuard(() => true);
        vi.useFakeTimers();
        captureSidecar.mockReset();
        captureReady.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it.each([undefined, { connectionEpoch: 0 }, { connectionEpoch: 7 }])(
        'binds a control retry to its original epoch %j',
        async (retry) => {
            const fetchMock = vi
                .fn()
                .mockResolvedValue(new Response(JSON.stringify({ ok: true, applied: { heater: 0 } }), { status: 200 }));
            vi.stubGlobal('fetch', fetchMock);
            await sidecar.setControl({ heater: 0 }, retry);
            expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(
                retry ? { heater: 0, retry_epoch: retry.connectionEpoch } : { heater: 0 },
            );
        },
    );

    it('retries startup failures and returns the first healthy status', async () => {
        let sidecarCalls = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(() => {
                sidecarCalls += 1;
                if (sidecarCalls === 1) return Promise.reject(new TypeError('Load failed'));
                return Promise.resolve(
                    new Response(JSON.stringify({ connected: false, roaster: null, error: null }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }),
                );
            }),
        );

        const pending = sidecar.waitUntilReady();
        await vi.advanceTimersByTimeAsync(400);

        await expect(pending).resolves.toMatchObject({ connected: false });
        expect(sidecarCalls).toBe(2);
        expect(captureSidecar).not.toHaveBeenCalled();
    });

    it('carries selected identity and notifies status owners only after settings succeed', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const refreshed = vi.fn();
        const unsubscribe = subscribeSidecarSettings(refreshed);
        try {
            await sidecar.connect('giesen_w45a_w60a', { host: 'example' }, 'b');
            expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
                roaster: 'giesen_w45a_w60a',
                machine_id: 'b',
            });
            fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
            await sidecar.updateSettings({ machine_id: 'b', connection_epoch: 2, ror_window_sec: 30 });
            expect(refreshed).toHaveBeenCalledOnce();
            fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'wrong target' }), { status: 409 }));
            await expect(
                sidecar.updateSettings({ machine_id: 'a', connection_epoch: 1, ror_window_sec: 30 }),
            ).rejects.toMatchObject({ message: 'wrong target', status: 409 });
            expect(captureSidecar).not.toHaveBeenCalled();
            expect(refreshed).toHaveBeenCalledOnce();
        } finally {
            unsubscribe();
        }
    });

    it('reports a fixed sidecar event for retryable 5xx responses', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValue(new Response(JSON.stringify({ error: 'host=10.0.0.2:502 down' }), { status: 503 })),
        );
        await expect(sidecar.getStatus()).rejects.toBeInstanceOf(SidecarHttpError);
        expect(captureSidecar).toHaveBeenCalledWith({
            route: '/status',
            method: 'GET',
            status: 503,
        });
        const blob = JSON.stringify(captureSidecar.mock.calls[0]);
        expect(blob).not.toContain('10.0.0.2');
    });

    it('does not report 502 or opaque network failures', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'plc fail' }), { status: 502 })),
        );
        await expect(sidecar.getStatus()).rejects.toMatchObject({ status: 502, sentryReported: false });
        expect(captureSidecar).not.toHaveBeenCalled();

        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        await expect(sidecar.getStatus()).rejects.toMatchObject({ status: 'network', sentryReported: false });
        expect(captureSidecar).not.toHaveBeenCalled();
    });

    it('reports one final readiness failure when concurrent callers exhaust the startup budget', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')));

        const pending = sidecar.waitUntilReady();
        expect(sidecar.waitUntilReady()).toBe(pending);
        const result = expect(pending).rejects.toMatchObject({ status: 'network', route: '/status' });
        await vi.advanceTimersByTimeAsync(30_000);

        await result;
        expect(captureSidecar).not.toHaveBeenCalled();
        expect(captureReady).toHaveBeenCalledExactlyOnceWith({
            episode: 1,
            attempts: 76,
            elapsedMs: 30_000,
            previouslyReady: false,
            status: 'network',
            errorType: 'SidecarHttpError',
        });
    });

    it('does not retry on request timeout (matches main — only opaque spawn failures retry)', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
        vi.stubGlobal('fetch', fetchMock);

        await expect(sidecar.waitUntilReady()).rejects.toMatchObject({ status: 'timeout', route: '/status' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports malformed ready responses without retrying or replacing the error', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
            );
        vi.stubGlobal('fetch', fetchMock);

        await expect(sidecar.waitUntilReady()).rejects.toBeInstanceOf(SyntaxError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(captureReady).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'unknown', errorType: 'SyntaxError', attempts: 1 }),
        );
        expect(captureSidecar).not.toHaveBeenCalled();
    });

    it('does not retry or report 2xx with malformed JSON (connect)', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
            );
        vi.stubGlobal('fetch', fetchMock);

        await expect(sidecar.connect('virtual', {})).rejects.toBeInstanceOf(SyntaxError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(captureSidecar).not.toHaveBeenCalled();
    });
    it('reports once per outage and records a prior successful readiness check', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
        vi.stubGlobal('fetch', fetchMock);
        await expect(sidecar.waitUntilReady()).rejects.toMatchObject({ status: 'timeout', sentryReported: true });
        await expect(sidecar.waitUntilReady()).rejects.toMatchObject({ status: 'timeout', sentryReported: true });
        expect(captureReady).toHaveBeenCalledTimes(1);
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ connected: false })));
        await expect(sidecar.waitUntilReady()).resolves.toMatchObject({ connected: false });
        await expect(sidecar.waitUntilReady()).rejects.toMatchObject({ status: 'timeout', sentryReported: true });
        expect(captureReady).toHaveBeenCalledTimes(2);
        expect(captureReady).toHaveBeenLastCalledWith(
            expect.objectContaining({ episode: 2, previouslyReady: true, attempts: 1 }),
        );
    });

    it('does not report an aborted readiness wait', async () => {
        const error = new DOMException('aborted', 'AbortError');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
        await expect(sidecar.waitUntilReady()).rejects.toBe(error);
        expect(captureReady).not.toHaveBeenCalled();
    });

    it('preserves the original readiness failure if telemetry throws', async () => {
        const error = new SyntaxError('invalid response');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
        captureReady.mockImplementation(() => {
            throw new Error('telemetry failed');
        });
        await expect(sidecar.waitUntilReady()).rejects.toBe(error);
    });

    it.each([502, 400, 409])('leaves probe HTTP %s reporting to its existing owner', async (status) => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'refused' }), { status })),
        );
        await expect(sidecar.doorProbe('fill_open')).rejects.toMatchObject({ status });
        expect(captureSidecar).not.toHaveBeenCalled();
    });

    it('denies opening but permits closing before a live roast store registers its guard', async () => {
        vi.resetModules();
        const { sidecar: unownedSidecar } = await import('./sidecar');
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ action: 'fill_close' })));
        vi.stubGlobal('fetch', fetchMock);
        await expect(unownedSidecar.doorProbe('fill_open')).rejects.toMatchObject({ status: 409 });
        expect(fetchMock).not.toHaveBeenCalled();
        await expect(unownedSidecar.doorProbe('fill_close')).resolves.toEqual({ action: 'fill_close' });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('blocks opening for every caller before requesting authentication', async () => {
        registerHopperOpenGuard(() => false);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const tokenCalls = vi.mocked(invoke).mock.calls.length;
        await expect(sidecar.doorProbe('fill_open')).rejects.toMatchObject({ status: 409, sentryReported: false });
        expect(vi.mocked(invoke).mock.calls).toHaveLength(tokenCalls);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(captureSidecar).not.toHaveBeenCalled();
    });

    it.each(['fill_open', 'fill_close'] as const)(
        'rechecks opening permission without blocking closing after authentication: %s',
        async (action) => {
            let allowed = true;
            registerHopperOpenGuard(() => allowed);
            let authenticate!: (token: string) => void;
            vi.mocked(invoke).mockReturnValueOnce(
                new Promise<string>((resolve) => {
                    authenticate = resolve;
                }),
            );
            const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ action })));
            vi.stubGlobal('fetch', fetchMock);
            const pending = sidecar.doorProbe(action);
            allowed = false;
            authenticate('test-token');
            if (action === 'fill_open') {
                await expect(pending).rejects.toMatchObject({ status: 409 });
                expect(fetchMock).not.toHaveBeenCalled();
            } else {
                await expect(pending).resolves.toEqual({ action });
                expect(fetchMock).toHaveBeenCalledOnce();
            }
            expect(captureSidecar).not.toHaveBeenCalled();
        },
    );

    it.each([
        'read',
        'fill_close',
        'discharge_open',
        'discharge_close',
        'cooling_on',
        'cooling_off',
        'stirrer_on',
        'stirrer_off',
    ] as const)('keeps %s independent of hopper opening admission', async (action) => {
        registerHopperOpenGuard(() => false);
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ action })));
        vi.stubGlobal('fetch', fetchMock);
        await expect(sidecar.doorProbe(action)).resolves.toEqual({ action });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it.each([
        [new TypeError('Failed to fetch'), 'network'],
        [new DOMException('timed out', 'TimeoutError'), 'timeout'],
    ])('reports a probe transport failure once with its action: %s', async (error, status) => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
        await expect(sidecar.doorProbe('stirrer_on')).rejects.toMatchObject({ status, sentryReported: true });
        expect(captureSidecar).toHaveBeenCalledExactlyOnceWith({
            route: '/door-probe',
            method: 'POST',
            status,
            action: 'stirrer_on',
        });
    });

    it('keeps probe delivery results and errors unchanged when telemetry fails', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ action: 'fill_open', wrote: 1 })));
        vi.stubGlobal('fetch', fetchMock);
        captureSidecar.mockImplementation(() => {
            throw new Error('telemetry failed');
        });
        await expect(sidecar.doorProbe('fill_open')).resolves.toEqual({ action: 'fill_open', wrote: 1 });
        expect(captureSidecar).not.toHaveBeenCalled();
        fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
        await expect(sidecar.doorProbe('fill_open')).rejects.toMatchObject({
            status: 'timeout',
            sentryReported: false,
        });
    });
});
