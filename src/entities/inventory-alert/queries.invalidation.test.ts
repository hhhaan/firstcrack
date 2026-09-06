import { dashboardKeys } from '@shared/lib/query-keys';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateAfterDismissAlert, inventoryAlertKeys } from './queries';

describe('inventory alert dismiss invalidation', () => {
    it('invalidateAfterDismissAlert hits list + dashboard with refetchType all', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const spy = vi.spyOn(qc, 'invalidateQueries');
        const userId = 'user-1';

        invalidateAfterDismissAlert(qc, userId);

        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey);
        const refetchTypes = spy.mock.calls.map((c) => (c[0] as { refetchType?: string })?.refetchType);
        expect(keys).toContainEqual(inventoryAlertKeys.list(userId));
        expect(keys).toContainEqual(dashboardKeys.all(userId));
        expect(refetchTypes).toContain('all');
    });
});
