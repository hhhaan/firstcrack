import { dashboardKeys, roastedStockKeys } from '@shared/lib/query-keys';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { applyOptimisticRoastSessionDelete, invalidateRoastSessionQueries, roastSessionKeys } from './queries';

const uid = 'user-1';

describe('roastSessionKeys shape', () => {
    it('nests paginated/counts/filterMeta/detail under all(userId) — not siblings', () => {
        expect(roastSessionKeys.all(uid)).toEqual(['roast_sessions', uid]);
        expect(roastSessionKeys.paginated(uid)).toEqual(['roast_sessions', uid, 'paginated']);
        expect(roastSessionKeys.paginated(uid, 'completed', 1, 10)).toEqual([
            'roast_sessions',
            uid,
            'paginated',
            'completed',
            1,
            10,
        ]);
        expect(roastSessionKeys.completedCount(uid)).toEqual(['roast_sessions', uid, 'completed_count']);
        expect(roastSessionKeys.completedMonthCount(uid)).toEqual(['roast_sessions', uid, 'completed_month_count']);
        expect(roastSessionKeys.filterMeta(uid)).toEqual(['roast_sessions', uid, 'filter_meta']);
        expect(roastSessionKeys.detail(uid, 's1')).toEqual(['roast_sessions', uid, 'detail', 's1']);

        // Old sibling shapes that miss prefix invalidation of all(userId)
        expect(roastSessionKeys.paginated(uid)[1]).not.toBe('paginated');
        expect(roastSessionKeys.completedCount(uid)[1]).not.toBe('completed_count');
        expect(roastSessionKeys.filterMeta(uid)[1]).not.toBe('filter_meta');
        expect(roastSessionKeys.detail(uid, 's1')[1]).not.toBe('detail');
    });
});

describe('roast session mutation invalidation', () => {
    it('invalidateRoastSessionQueries hits all(userId) + dashboard with refetchType all', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);

        await invalidateRoastSessionQueries(qc, uid);

        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey);
        const refetchTypes = spy.mock.calls.map((c) => (c[0] as { refetchType?: string })?.refetchType);
        expect(keys).toContainEqual(roastSessionKeys.all(uid));
        expect(keys).toContainEqual(dashboardKeys.all(uid));
        expect(keys).not.toContainEqual(['roast_sessions']);
        expect(spy).toHaveBeenCalledTimes(2);
        expect(refetchTypes.every((t) => t === 'all')).toBe(true);
    });

    it('nested caches under all(userId) invalidate from the shared helper (History remount + quota + dashboard)', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        const pageKey = roastSessionKeys.paginated(uid, 'completed', 1, 10);
        const countKey = roastSessionKeys.completedCount(uid);
        const monthKey = roastSessionKeys.completedMonthCount(uid);
        const metaKey = roastSessionKeys.filterMeta(uid);
        const detailKey = roastSessionKeys.detail(uid, 's1');
        const dashKey = dashboardKeys.all(uid);

        qc.setQueryData(pageKey, { data: [], total: 0 });
        qc.setQueryData(countKey, 1);
        qc.setQueryData(monthKey, 1);
        qc.setQueryData(metaKey, []);
        qc.setQueryData(detailKey, { id: 's1' });
        qc.setQueryData(dashKey, {});

        await invalidateRoastSessionQueries(qc, uid);

        expect(qc.getQueryState(pageKey)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(countKey)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(monthKey)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(metaKey)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(detailKey)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(dashKey)?.isInvalidated).toBe(true);
    });

    it('optimistic delete setQueriesData hits real paginated page caches', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const pageKey = roastSessionKeys.paginated(uid, 'completed', 1, 10, 'date', false, null, null, null);
        const keep = { id: 'keep', status: 'completed' };
        const gone = { id: 'gone', status: 'completed' };
        qc.setQueryData(pageKey, { data: [keep, gone], total: 2 });
        qc.setQueryData(roastSessionKeys.all(uid), [keep, gone]);

        applyOptimisticRoastSessionDelete(qc, uid, 'gone');

        expect(qc.getQueryData(pageKey)).toEqual({ data: [keep], total: 1 });
        expect(qc.getQueryData(roastSessionKeys.all(uid))).toEqual([keep]);
    });

    it('delete invalidation of roastedStockKeys.byUser also drops nested events', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        const eventsKey = roastedStockKeys.events(uid);
        qc.setQueryData(eventsKey, [{ id: 'ev-1' }]);

        await qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(uid) });

        expect(eventsKey).toEqual([...roastedStockKeys.byUser(uid), 'events']);
        expect(qc.getQueryState(eventsKey)?.isInvalidated).toBe(true);
    });
});
