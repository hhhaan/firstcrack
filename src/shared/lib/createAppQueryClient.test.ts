import * as Sentry from '@sentry/react';
import { SidecarHttpError } from '@shared/lib/sidecar';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from './createAppQueryClient';

vi.mock('./mutationErrorToast', () => ({
    showMutationErrorToast: vi.fn(),
}));

vi.mock('@sentry/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sentry/react')>();
    return { ...actual, captureException: vi.fn(), captureMessage: vi.fn(), init: vi.fn() };
});

describe('createAppQueryClient (main.tsx wiring)', () => {
    afterEach(() => vi.clearAllMocks());

    it('maps QueryCache onError meta to Sentry tags', async () => {
        const client = createAppQueryClient();
        await expect(
            client.fetchQuery({
                queryKey: ['app-rq-sentry'],
                queryFn: () => {
                    throw { code: '50000', message: 'fail', details: 'x', hint: 'y' };
                },
                meta: { feature: 'plan-batch', rpc: 'reorder_plan_batches' },
            }),
        ).rejects.toBeDefined();

        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const [, hint] = vi.mocked(Sentry.captureException).mock.calls[0] as [
            unknown,
            { tags?: Record<string, string> },
        ];
        expect(hint.tags).toEqual({
            feature: 'plan-batch',
            rpc: 'reorder_plan_batches',
            'db.code': '50000',
        });
    });

    it('maps MutationCache onError meta to Sentry tags', async () => {
        const client = createAppQueryClient();
        const err = new Error('mutation failed');
        const mutation = client.getMutationCache().build(client, {
            mutationFn: () => Promise.reject(err),
            meta: { feature: 'roast-session', rpc: 'update_roast_session' },
        });
        await expect(mutation.execute(undefined)).rejects.toBe(err);

        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const [, hint] = vi.mocked(Sentry.captureException).mock.calls[0] as [
            unknown,
            { tags?: Record<string, string> },
        ];
        expect(hint.tags).toEqual({
            feature: 'roast-session',
            rpc: 'update_roast_session',
        });
    });

    it('does not capture 502 SidecarHttpError from QueryCache onError (useSidecarStatus path)', async () => {
        const client = createAppQueryClient();
        const err = new SidecarHttpError('/status', 502, 'plc fail', false);
        await expect(
            client.fetchQuery({
                queryKey: ['sidecar', 'status'],
                queryFn: () => {
                    throw err;
                },
            }),
        ).rejects.toBe(err);

        expect(Sentry.captureException).not.toHaveBeenCalled();
    });
});
