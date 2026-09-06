import { dashboardKeys, inventoryQueryRoots } from '@shared/lib/query-keys';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateAfterDeleteBean } from './queries';

describe('bean delete invalidation', () => {
    it('invalidateAfterDeleteBean hits summaries, alerts, and dashboard', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const spy = vi.spyOn(qc, 'invalidateQueries');
        const userId = 'user-1';

        invalidateAfterDeleteBean(qc, userId);

        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey);
        const refetchTypes = spy.mock.calls.map((c) => (c[0] as { refetchType?: string })?.refetchType);
        expect(keys).toContainEqual(inventoryQueryRoots.beanStockSummaries);
        expect(keys).toContainEqual(inventoryQueryRoots.inventoryAlerts);
        expect(keys).toContainEqual(dashboardKeys.all(userId));
        expect(refetchTypes).toContain('all');
    });
});
