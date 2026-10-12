import * as Sentry from '@sentry/react';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportReactQueryError } from './sentry';

vi.mock('@sentry/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sentry/react')>();
    return { ...actual, captureException: vi.fn(), init: vi.fn() };
});

describe('reportReactQueryError', () => {
    afterEach(() => vi.clearAllMocks());

    it('maps React Query mutation meta to Sentry tags (main.tsx cache wiring)', async () => {
        const client = new QueryClient({
            queryCache: new QueryCache({
                onError: (error, query) => reportReactQueryError(error, query.meta as Record<string, unknown>),
            }),
            mutationCache: new MutationCache({
                onError: (error, _v, _c, mutation) =>
                    reportReactQueryError(error, mutation.meta as Record<string, unknown>),
            }),
        });

        await expect(
            client.fetchQuery({
                queryKey: ['rq-sentry'],
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
