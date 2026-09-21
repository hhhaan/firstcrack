// @vitest-environment jsdom
import { orderKeys } from '@shared/lib/query-keys';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orderApi } from './api';
import { useOrdersPaginated } from './queries';

vi.mock('./api', () => ({
    orderApi: { listPaginated: vi.fn() },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const uid = 'user-1';
const pageSize = 20;
const filter = {
    status: 'all' as const,
    platform: null,
    search: '',
    fromYM: null,
    toYM: null,
};

const pageKey = (page: number) => orderKeys.paginated(uid, { page, pageSize, ...filter });

const calledPages = () => vi.mocked(orderApi.listPaginated).mock.calls.map((c) => (c[0] as { page: number }).page);

describe('useOrdersPaginated N+1 prefetch', () => {
    let qc: QueryClient;
    let root: ReturnType<typeof createRoot>;
    let latest!: ReturnType<typeof useOrdersPaginated>;

    const flush = async () => {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 10));
        });
    };

    const waitUntil = async (pred: () => boolean) => {
        for (let i = 0; i < 50; i++) {
            if (pred()) return;
            await flush();
        }
        throw new Error(`timeout; pages=${JSON.stringify(calledPages())}`);
    };

    function Probe({ page }: { page: number }) {
        latest = useOrdersPaginated({
            userId: uid,
            page,
            pageSize,
            ...filter,
        });
        return null;
    }

    const renderHook = async (page: number) => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={qc}>
                    <Probe page={page} />
                </QueryClientProvider>,
            );
        });
        await flush();
    };

    const observers = (page: number) =>
        qc
            .getQueryCache()
            .find({ queryKey: pageKey(page) })
            ?.getObserversCount() ?? 0;

    beforeEach(() => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        root = createRoot(document.createElement('div'));
        vi.mocked(orderApi.listPaginated).mockReset();
        vi.mocked(orderApi.listPaginated).mockImplementation(async (p) => ({
            data: [{ id: `o${p.page}` }] as never,
            total: 45,
        }));
    });

    afterEach(() => {
        act(() => root.unmount());
        qc.clear();
    });

    it('prefetches N+1 after current page succeeds and keeps it active', async () => {
        await renderHook(1);
        await waitUntil(() => calledPages().includes(2));
        expect(calledPages()).toEqual([1, 2]);
        expect(latest.data?.data).toEqual([{ id: 'o1' }]);
        expect(observers(1)).toBe(1);
        expect(observers(2)).toBe(1);
    });

    it('serves the next numbered page from cache without refetching it', async () => {
        await renderHook(1);
        await waitUntil(() => calledPages().includes(2));
        await renderHook(2);
        await waitUntil(() => calledPages().includes(3));
        expect(latest.data?.data).toEqual([{ id: 'o2' }]);
        expect(latest.isPlaceholderData).toBe(false);
        expect(calledPages()).toEqual([1, 2, 3]);
        expect(observers(2)).toBe(1);
        expect(observers(3)).toBe(1);
    });

    it('does not prefetch past the last page', async () => {
        vi.mocked(orderApi.listPaginated).mockImplementation(async (p) => ({
            data: [{ id: `o${p.page}` }] as never,
            total: 20,
        }));
        await renderHook(1);
        await waitUntil(() => calledPages().includes(1) && latest.isSuccess);
        await flush();
        expect(calledPages()).toEqual([1]);
        expect(qc.getQueryState(pageKey(2))?.fetchStatus).toBe('idle');
        expect(qc.getQueryState(pageKey(2))?.data).toBeUndefined();
    });

    it('does not prefetch N+1 from placeholder total while the current page is loading', async () => {
        vi.mocked(orderApi.listPaginated).mockImplementation(async (p) => ({
            data: [{ id: `o${p.page}` }] as never,
            total: 100,
        }));
        await renderHook(1);
        await waitUntil(() => calledPages().includes(2));

        let finishPage3!: (value: { data: never[]; total: number }) => void;
        vi.mocked(orderApi.listPaginated).mockImplementation((p) => {
            if (p.page === 3) {
                return new Promise((resolve) => {
                    finishPage3 = resolve;
                });
            }
            return Promise.resolve({ data: [{ id: `o${p.page}` }] as never, total: 100 });
        });

        await renderHook(3);
        await waitUntil(() => calledPages().filter((p) => p === 3).length >= 1);
        await flush();
        expect(calledPages().filter((p) => p === 4)).toEqual([]);
        expect(latest.isPlaceholderData).toBe(true);

        await act(async () => {
            finishPage3({ data: [{ id: 'o3' }] as never, total: 100 });
        });
        await waitUntil(() => calledPages().includes(4));
        expect(latest.isPlaceholderData).toBe(false);
        expect(latest.data?.data).toEqual([{ id: 'o3' }]);
    });

    it('refetches the active N+1 page on default (active) invalidation', async () => {
        await renderHook(1);
        await waitUntil(() => calledPages().includes(2));
        const before = calledPages().length;

        await act(async () => {
            await qc.invalidateQueries({ queryKey: orderKeys.all(uid) });
        });
        await waitUntil(() => calledPages().length >= before + 2);
        expect(calledPages().slice(before).sort()).toEqual([1, 2]);
    });
});
