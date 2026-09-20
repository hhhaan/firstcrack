// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roastSessionApi } from './api';
import { roastSessionKeys, useRoastSessionsPaginated } from './queries';

vi.mock('./api', () => ({
    roastSessionApi: { listPaginated: vi.fn() },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const uid = 'user-1';
const pageSize = 10;

const pageKey = (page: number) =>
    roastSessionKeys.paginated(uid, 'completed', page, pageSize, 'date', false, null, null, null);

const calledPages = () =>
    vi.mocked(roastSessionApi.listPaginated).mock.calls.map((c) => (c[0] as { page: number }).page);

describe('useRoastSessionsPaginated N+1 prefetch', () => {
    let qc: QueryClient;
    let root: ReturnType<typeof createRoot>;
    let latest!: ReturnType<typeof useRoastSessionsPaginated>;

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

    function Probe({ page, enabled }: { page: number; enabled?: boolean }) {
        latest = useRoastSessionsPaginated({
            userId: uid,
            status: 'completed',
            page,
            pageSize,
            sortKey: 'date',
            sortAsc: false,
            level: null,
            fromYM: null,
            toYM: null,
            enabled,
        });
        return null;
    }

    const renderHook = async (opts: { page: number; enabled?: boolean }) => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={qc}>
                    <Probe page={opts.page} enabled={opts.enabled} />
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
        vi.mocked(roastSessionApi.listPaginated).mockReset();
        vi.mocked(roastSessionApi.listPaginated).mockImplementation(async (p) => ({
            data: [{ id: `s${p.page}` }] as never,
            total: 25,
        }));
    });

    afterEach(() => {
        act(() => root.unmount());
        qc.clear();
    });

    it('prefetches N+1 after current page succeeds and keeps it active', async () => {
        await renderHook({ page: 1 });
        await waitUntil(() => calledPages().includes(2));
        expect(calledPages()).toEqual([1, 2]);
        expect(latest.data?.data).toEqual([{ id: 's1' }]);
        expect(observers(1)).toBe(1);
        expect(observers(2)).toBe(1);
    });

    it('does not prefetch past the last page', async () => {
        vi.mocked(roastSessionApi.listPaginated).mockImplementation(async (p) => ({
            data: [{ id: `s${p.page}` }] as never,
            total: 10,
        }));
        await renderHook({ page: 1 });
        await waitUntil(() => calledPages().includes(1) && latest.isSuccess);
        await flush();
        expect(calledPages()).toEqual([1]);
        expect(qc.getQueryState(pageKey(2))?.fetchStatus).toBe('idle');
        expect(qc.getQueryState(pageKey(2))?.data).toBeUndefined();
    });

    it('does not fetch when History client pagination disables the query', async () => {
        await renderHook({ page: 1, enabled: false });
        await flush();
        expect(calledPages()).toEqual([]);
    });

    it('does not prefetch N+1 from placeholder total while the current page is loading', async () => {
        vi.mocked(roastSessionApi.listPaginated).mockImplementation(async (p) => ({
            data: [{ id: `s${p.page}` }] as never,
            total: 100,
        }));
        await renderHook({ page: 1 });
        await waitUntil(() => calledPages().includes(2));

        let finishPage3!: (value: { data: never[]; total: number }) => void;
        vi.mocked(roastSessionApi.listPaginated).mockImplementation((p) => {
            if (p.page === 3) {
                return new Promise((resolve) => {
                    finishPage3 = resolve;
                });
            }
            return Promise.resolve({ data: [{ id: `s${p.page}` }] as never, total: 100 });
        });

        await renderHook({ page: 3 });
        await waitUntil(() => calledPages().filter((p) => p === 3).length >= 1);
        await flush();
        expect(calledPages().filter((p) => p === 4)).toEqual([]);
        expect(latest.isPlaceholderData).toBe(true);

        await act(async () => {
            finishPage3({ data: [{ id: 's3' }] as never, total: 100 });
        });
        await waitUntil(() => calledPages().includes(4));
        expect(latest.isPlaceholderData).toBe(false);
        expect(latest.data?.data).toEqual([{ id: 's3' }]);
    });

    it('refetches the active N+1 page on default invalidation', async () => {
        await renderHook({ page: 1 });
        await waitUntil(() => calledPages().includes(2));
        const before = calledPages().length;

        await act(async () => {
            await qc.invalidateQueries({ queryKey: roastSessionKeys.all(uid) });
        });
        await waitUntil(() => calledPages().length >= before + 2);
        expect(calledPages().slice(before).sort()).toEqual([1, 2]);
    });
});
