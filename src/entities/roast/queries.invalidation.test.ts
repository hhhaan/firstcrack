import { dashboardKeys, roastedStockKeys, roastProfileQueryRoots } from '@shared/lib/query-keys';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
    beginOptimisticRoastSessionDelete,
    beginOptimisticSessionBeanOrigin,
    revertOptimisticRoastSessionEdit,
} from './historyOptimistic';
import { invalidateAfterRoastRecordEdit, invalidateRoastSessionQueries, roastSessionKeys } from './queries';

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
        expect(keys).toContainEqual([...roastProfileQueryRoots.profiles, uid]);
        expect(keys).toContainEqual(dashboardKeys.all(uid));
        expect(keys).toContainEqual(roastProfileQueryRoots.beanHistory);
        expect(keys).toContainEqual(roastProfileQueryRoots.consistency);
        expect(keys).not.toContainEqual(['roast_sessions']);
        expect(spy).toHaveBeenCalledTimes(5);
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

    it('optimistic delete hits real paginated page caches', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const pageKey = roastSessionKeys.paginated(uid, 'completed', 1, 10, 'date', false, null, null, null);
        const keep = { id: 'keep', status: 'completed' };
        const gone = { id: 'gone', status: 'completed' };
        qc.setQueryData(pageKey, { data: [keep, gone], total: 2 });
        qc.setQueryData(roastSessionKeys.all(uid), [keep, gone]);

        await beginOptimisticRoastSessionDelete(qc, uid, 'gone');

        expect(qc.getQueryData(pageKey)).toEqual({ data: [keep], total: 1 });
        expect(qc.getQueryData(roastSessionKeys.all(uid))).toEqual([keep]);
    });

    it('optimistic delete removes a row from infinite pages and decrements the shared total once', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const infiniteKey = roastSessionKeys.infinite(uid, 'completed', 10);
        const keep = { id: 'keep', status: 'completed' };
        const gone = { id: 'gone', status: 'completed' };
        qc.setQueryData(infiniteKey, {
            pages: [
                { data: [gone], total: 2 },
                { data: [keep], total: 2 },
            ],
            pageParams: [1, 2],
        });

        await beginOptimisticRoastSessionDelete(qc, uid, 'gone');

        expect(qc.getQueryData(infiniteKey)).toEqual({
            pages: [
                { data: [], total: 1 },
                { data: [keep], total: 1 },
            ],
            pageParams: [1, 2],
        });
    });

    it('delete invalidation of roastedStockKeys.byUser also drops nested events', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        const eventsKey = roastedStockKeys.events(uid);
        qc.setQueryData(eventsKey, [{ id: 'ev-1' }]);

        await qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(uid) });

        expect(eventsKey).toEqual([...roastedStockKeys.byUser(uid), 'events']);
        expect(qc.getQueryState(eventsKey)?.isInvalidated).toBe(true);
    });

    it('record edit refreshes session reads and derived profile caches, never inventory', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        const detailKey = roastSessionKeys.detail(uid, 's1');
        const profileList = [...roastProfileQueryRoots.profiles, uid];
        const sourceEvents = [...roastProfileQueryRoots.profiles, 'source_events', 's1'];
        const consistency = [...roastProfileQueryRoots.consistency, 'p1'];
        const previousProfile = [...roastProfileQueryRoots.beanHistory, 'p-old'];
        const nextProfile = [...roastProfileQueryRoots.beanHistory, 'p-new'];
        const stock = roastedStockKeys.byUser(uid);
        for (const key of [detailKey, profileList, sourceEvents, consistency, previousProfile, nextProfile, stock]) {
            qc.setQueryData(key, {});
        }

        await invalidateAfterRoastRecordEdit(qc, uid);

        expect(qc.getQueryState(detailKey)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(profileList)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(sourceEvents)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(consistency)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(previousProfile)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(nextProfile)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(stock)?.isInvalidated).toBe(false);
    });

    it('refreshes an observed profile stat and invalidates an unobserved one, then reuses a fresh cache', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        const liveKey = [...roastProfileQueryRoots.beanHistory, 'p-live'];
        const idleKey = [...roastProfileQueryRoots.consistency, 'p-idle'];
        let fetches = 0;
        const queryFn = async () => {
            fetches += 1;
            return [{ name: 'Yirg', count: fetches, lastDate: '2026-09-01' }];
        };

        await qc.fetchQuery({ queryKey: liveKey, queryFn, staleTime: Infinity });
        await qc.fetchQuery({ queryKey: liveKey, queryFn, staleTime: Infinity });
        expect(fetches).toBe(1);

        qc.setQueryData(idleKey, [{ weight_grams: 1000 }]);
        await invalidateRoastSessionQueries(qc, uid);

        expect(qc.getQueryState(idleKey)?.isInvalidated).toBe(true);
        await qc.fetchQuery({ queryKey: liveKey, queryFn, staleTime: Infinity });
        expect(fetches).toBe(2);
        await qc.fetchQuery({ queryKey: liveKey, queryFn, staleTime: Infinity });
        expect(fetches).toBe(2);
    });
});

const sessionRow = (id: string, beanId = 'bean-1', origin = 'Ethiopia') =>
    ({
        id,
        status: 'completed',
        bean_id: beanId,
        notes: 'old',
        beans: { name: 'Aricha', origin, region: null, variety: null, process: null, farm: null },
        roast_profiles: null,
    }) as RoastSessionWithRelations;

describe('optimistic history edits', () => {
    it('patches every list shape for the bean and leaves counts, filter meta, and other users', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const pageKey = roastSessionKeys.paginated(uid, 'completed', 1, 10, 'date', false, null, null, null);
        const infiniteKey = roastSessionKeys.infinite(uid, 'completed', 10);
        const detailKey = roastSessionKeys.detail(uid, 's1');
        const otherKey = roastSessionKeys.all('other');
        const metaKey = roastSessionKeys.filterMeta(uid);
        const countKey = roastSessionKeys.completedCount(uid);
        const match = sessionRow('s1');
        const otherBean = sessionRow('s2', 'bean-2', 'Kenya');
        const page = { data: [match, otherBean], total: 2 };
        const meta = [{ roasted_at: '2026-01-01', beans: { origin: 'Ethiopia' } }];

        qc.setQueryData(roastSessionKeys.all(uid), [match, otherBean]);
        qc.setQueryData(pageKey, page);
        qc.setQueryData(infiniteKey, { pages: [page, { data: [sessionRow('s3')], total: 2 }], pageParams: [1, 2] });
        qc.setQueryData(detailKey, match);
        qc.setQueryData(otherKey, [match]);
        qc.setQueryData(metaKey, meta);
        qc.setQueryData(countKey, 4);

        const edit = await beginOptimisticSessionBeanOrigin(qc, uid, 'bean-1', 'Colombia');

        const originOf = (row: { beans: { origin: string | null } | null }) => row.beans?.origin;
        expect(originOf((qc.getQueryData(pageKey) as typeof page).data[0])).toBe('Colombia');
        expect(originOf((qc.getQueryData(pageKey) as typeof page).data[1])).toBe('Kenya');
        expect(originOf((qc.getQueryData(roastSessionKeys.all(uid)) as (typeof match)[])[0])).toBe('Colombia');
        const infinite = qc.getQueryData(infiniteKey) as { pages: Array<{ data: (typeof match)[] }> };
        expect(originOf(infinite.pages[0].data[0])).toBe('Colombia');
        expect(originOf(infinite.pages[1].data[0])).toBe('Colombia');
        expect(originOf(qc.getQueryData(detailKey) as typeof match)).toBe('Colombia');
        expect(qc.getQueryData(otherKey)).toEqual([match]);
        expect(qc.getQueryData(metaKey)).toEqual(meta);
        expect(qc.getQueryData(countKey)).toBe(4);

        revertOptimisticRoastSessionEdit(qc, uid, edit);
        expect(originOf((qc.getQueryData(pageKey) as typeof page).data[0])).toBe('Ethiopia');
        expect(originOf(qc.getQueryData(detailKey) as typeof match)).toBe('Ethiopia');
    });
});
