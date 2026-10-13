import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockResolvedValue('test-token'),
}));

const { captureSidecar } = vi.hoisted(() => ({ captureSidecar: vi.fn() }));
vi.mock('./sentry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./sentry')>();
    return { ...actual, captureSidecarRequestFailure: captureSidecar, isSentryEnabled: true };
});

import { SidecarHttpError, sidecar, subscribeSidecarSettings } from './sidecar';

describe('sidecar.waitUntilReady', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        captureSidecar.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

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

    it('reports once when the startup retry budget is exhausted without Sentry noise', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')));

        const result = expect(sidecar.waitUntilReady()).rejects.toMatchObject({ status: 'network', route: '/status' });
        await vi.advanceTimersByTimeAsync(30_000);

        await result;
        expect(captureSidecar).not.toHaveBeenCalled();
    });

    it('does not retry on request timeout (matches main — only opaque spawn failures retry)', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
        vi.stubGlobal('fetch', fetchMock);

        await expect(sidecar.waitUntilReady()).rejects.toMatchObject({ status: 'timeout', route: '/status' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry or report 2xx with malformed JSON (waitUntilReady)', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
            );
        vi.stubGlobal('fetch', fetchMock);

        await expect(sidecar.waitUntilReady()).rejects.toBeInstanceOf(SyntaxError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
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
});
