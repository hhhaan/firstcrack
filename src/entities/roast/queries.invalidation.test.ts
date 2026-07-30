import { dashboardKeys } from '@shared/lib/query-keys';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateAfterCreateRoastSession, roastSessionKeys } from './queries';

describe('roast session mutation invalidation', () => {
    it('create invalidates list, paginated, completed count, filter meta, and dashboard with refetchType all', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);

        await invalidateAfterCreateRoastSession(qc, 'user-1');

        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey);
        const refetchTypes = spy.mock.calls.map((c) => (c[0] as { refetchType?: string })?.refetchType);
        expect(keys).toContainEqual(roastSessionKeys.all('user-1'));
        expect(keys).toContainEqual(roastSessionKeys.paginated('user-1'));
        expect(keys).toContainEqual(roastSessionKeys.completedCount('user-1'));
        // Pre-roast quota gate reads this — a stale month count lets a capped user charge.
        expect(keys).toContainEqual(roastSessionKeys.completedMonthCount('user-1'));
        expect(keys).toContainEqual(roastSessionKeys.filterMeta('user-1'));
        expect(keys).toContainEqual(dashboardKeys.all('user-1'));
        expect(spy).toHaveBeenCalledTimes(6);
        expect(refetchTypes.every((t) => t === 'all')).toBe(true);
    });

    it('marks inactive paginated cache invalidated so History remount refetches', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        const key = [...roastSessionKeys.paginated('user-1'), 'completed', 1, 10] as const;
        qc.setQueryData(key, { data: [], total: 0 });

        await invalidateAfterCreateRoastSession(qc, 'user-1');

        const state = qc.getQueryState(key);
        expect(state?.isInvalidated).toBe(true);
    });
});
