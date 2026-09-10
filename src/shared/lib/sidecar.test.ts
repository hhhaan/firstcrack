import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockResolvedValue('test-token'),
}));

vi.mock('./logger', () => ({
    logger: { error: vi.fn() },
}));

import { logger } from './logger';
import { sidecar } from './sidecar';

describe('sidecar.waitUntilReady', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.mocked(logger.error).mockClear();
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
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('reports once when the startup retry budget is exhausted', async () => {
        const error = new TypeError('Load failed');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));

        const result = expect(sidecar.waitUntilReady()).rejects.toBe(error);
        await vi.advanceTimersByTimeAsync(30_000);

        await result;
        expect(logger.error).toHaveBeenCalledOnce();
    });
});
