import * as Sentry from '@sentry/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from './createAppQueryClient';

vi.mock('./mutationErrorToast', () => ({
    showMutationErrorToast: vi.fn(),
}));

vi.mock('@sentry/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sentry/react')>();
    return { ...actual, captureException: vi.fn(), init: vi.fn() };
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
});
