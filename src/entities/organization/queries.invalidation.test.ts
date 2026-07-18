import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateOrganizationQueries, organizationKeys } from './queries';

describe('organization mutation invalidation', () => {
    it('invalidates organization root prefix', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const spy = vi.spyOn(qc, 'invalidateQueries');
        const userId = 'user-1';

        invalidateOrganizationQueries(qc, userId);

        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey);
        expect(keys).toContainEqual(organizationKeys.all);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
