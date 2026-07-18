import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateOrganizationQueries, organizationKeys } from './queries';

describe('organization mutation invalidation', () => {
    it('invalidates mine + memberships + all root', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const spy = vi.spyOn(qc, 'invalidateQueries');
        const userId = 'user-1';

        invalidateOrganizationQueries(qc, userId);

        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey);
        expect(keys).toContainEqual(organizationKeys.mine(userId));
        expect(keys).toContainEqual(organizationKeys.memberships(userId));
        expect(keys).toContainEqual(organizationKeys.all);
    });
});
