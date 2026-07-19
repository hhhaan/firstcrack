import { dashboardKeys } from '@shared/lib/query-keys';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateAfterCreateRoastSession, roastSessionKeys } from './queries';

describe('roast session mutation invalidation', () => {
    it('create invalidates list, paginated, completed count, filter meta, and dashboard', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const spy = vi.spyOn(qc, 'invalidateQueries');

        invalidateAfterCreateRoastSession(qc, 'user-1');

        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey);
        expect(keys).toContainEqual(roastSessionKeys.all('user-1'));
        expect(keys).toContainEqual(roastSessionKeys.paginated('user-1'));
        expect(keys).toContainEqual(roastSessionKeys.completedCount('user-1'));
        expect(keys).toContainEqual(roastSessionKeys.filterMeta('user-1'));
        expect(keys).toContainEqual(dashboardKeys.all('user-1'));
        expect(spy).toHaveBeenCalledTimes(5);
    });
});
