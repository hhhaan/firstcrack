// @vitest-environment jsdom

import { beanKeys } from '@entities/bean';
import { roastSessionKeys } from '@entities/roast';
import { beginOptimisticRoastSessionEdit, finishOptimisticRoastSessionEdit } from '@entities/roast/historyOptimistic';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateRoastBeanOrigin } from './useUpdateRoastBeanOrigin';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mutateBean } = vi.hoisted(() => ({
    mutateBean: vi.fn<(input: { id: string; origin: string | null }) => Promise<unknown>>(),
}));

vi.mock('@entities/bean', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@entities/bean')>();
    return { ...actual, beanApi: { ...actual.beanApi, update: mutateBean } };
});

const userId = 'owner';
const session = {
    id: 'session-1',
    status: 'completed',
    bean_id: 'bean-1',
    notes: 'old',
    beans: { name: 'Aricha', origin: 'Ethiopia' },
} as RoastSessionWithRelations;

describe('useUpdateRoastBeanOrigin', () => {
    let qc: QueryClient;
    let root: Root;
    let latest: ReturnType<typeof useUpdateRoastBeanOrigin>;

    const cached = () => qc.getQueryData<RoastSessionWithRelations[]>(roastSessionKeys.all(userId))?.[0];

    function Probe() {
        latest = useUpdateRoastBeanOrigin(userId);
        return null;
    }

    beforeEach(async () => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        qc.setQueryData(roastSessionKeys.all(userId), [session]);
        root = createRoot(document.createElement('div'));
        mutateBean.mockReset();
        await act(async () => {
            root.render(
                <QueryClientProvider client={qc}>
                    <Probe />
                </QueryClientProvider>,
            );
        });
    });

    afterEach(() => {
        act(() => root.unmount());
        qc.clear();
    });

    it('applies the origin before the bean save resolves and keeps it after success', async () => {
        let release: (() => void) | undefined;
        mutateBean.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

        let saving: Promise<void> = Promise.resolve();
        await act(async () => {
            saving = latest.mutateAsync({ id: 'bean-1', origin: 'Colombia' });
        });

        expect(cached()?.beans?.origin).toBe('Colombia');
        expect(mutateBean).toHaveBeenCalledWith({ id: 'bean-1', origin: 'Colombia' });

        await act(async () => {
            release?.();
            await saving;
        });
        expect(cached()?.beans?.origin).toBe('Colombia');
    });

    it('rejects the bean error while preserving a concurrent roast-field edit', async () => {
        const failure = new Error('bean save failed');
        let reject: ((error: Error) => void) | undefined;
        mutateBean.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => (reject = rejectPromise)));

        let saving: Promise<void> = Promise.resolve();
        await act(async () => {
            saving = latest.mutateAsync({ id: 'bean-1', origin: 'Colombia' });
        });
        const concurrent = await beginOptimisticRoastSessionEdit(qc, userId, (row) =>
            row.id === session.id ? { ...row, notes: 'concurrent' } : row,
        );

        await act(async () => {
            reject?.(failure);
            await expect(saving).rejects.toBe(failure);
        });

        expect(cached()).toMatchObject({ notes: 'concurrent', beans: { origin: 'Ethiopia' } });
        await finishOptimisticRoastSessionEdit(qc, userId, concurrent, async () => undefined);
    });

    it('reconciles bean caches after a later origin succeeds and an earlier origin fails', async () => {
        const key = beanKeys.all(userId);
        let serverOrigin = 'Ethiopia';
        qc.setQueryDefaults(key, { queryFn: async () => [{ id: 'bean-1', origin: serverOrigin }] });
        qc.setQueryData(key, [{ id: 'bean-1', origin: serverOrigin }]);
        let rejectFirst: ((error: Error) => void) | undefined;
        mutateBean.mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFirst = reject)));
        let first = Promise.resolve();
        await act(async () => {
            first = latest.mutateAsync({ id: 'bean-1', origin: 'Kenya' });
        });
        mutateBean.mockImplementationOnce(async () => {
            serverOrigin = 'Colombia';
        });
        await act(async () => {
            await latest.mutateAsync({ id: 'bean-1', origin: 'Colombia' });
        });
        await act(async () => {
            rejectFirst?.(new Error('earlier write failed'));
            await expect(first).rejects.toThrow('earlier write failed');
        });
        expect(qc.getQueryData(key)).toEqual([{ id: 'bean-1', origin: 'Colombia' }]);
        expect(cached()?.beans?.origin).toBe('Colombia');
    });
});
