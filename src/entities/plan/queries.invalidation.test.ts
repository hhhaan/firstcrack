import { dashboardKeys, planQueryRoots } from '@shared/lib/query-keys';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateAfterCreatePlanBatch, planKeys, scheduledBatchInvalidationKeys } from './queries';

describe('plan mutation invalidation', () => {
    it('scheduled keys are planQueryRoots prefixes (staleTime Infinity guard)', () => {
        const keys = scheduledBatchInvalidationKeys();
        expect(keys).toContainEqual(planQueryRoots.dayBatches);
        expect(keys).toContainEqual(planQueryRoots.rangeBatches);
        expect(keys).toContainEqual(planQueryRoots.rangeSummary);
        expect(keys).toContainEqual(planQueryRoots.weekSummary);
        expect(keys).toContainEqual(planQueryRoots.monthSummary);
        expect(planKeys.dayBatchesRoot).toEqual(planQueryRoots.dayBatches);
    });

    it('invalidateAfterCreatePlanBatch hits plan batches + all schedule roots', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const spy = vi.spyOn(qc, 'invalidateQueries');

        invalidateAfterCreatePlanBatch(qc, 'plan-1');

        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: readonly unknown[] })?.queryKey);
        expect(keys).toContainEqual(planKeys.batches('plan-1'));
        for (const root of scheduledBatchInvalidationKeys()) {
            expect(keys).toContainEqual(root);
        }
        expect(keys).toContainEqual(dashboardKeys.root);
    });
});
