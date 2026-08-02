import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => from(...args),
    },
}));

vi.mock('./recurrence-rule', () => ({
    recurrenceRuleApi: {
        listActive: vi.fn(async () => []),
    },
}));

import { listForDateRange } from './list-for-date-range';

type Result = { data: unknown; error: unknown };

/** Supabase builder: chainable filter methods, awaitable (thenable) result. */
function thenable(result: Result) {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'not', 'is', 'in']) {
        q[m] = vi.fn(() => q);
    }
    // biome-ignore lint/suspicious/noThenProperty: supabase builder is a thenable by design — mock mirrors it
    q.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
    return q;
}

describe('listForDateRange one-off batches', () => {
    beforeEach(() => {
        from.mockReset();
    });

    it('backfills null scheduled_date from the owning plan date', async () => {
        const oneOff = {
            id: 'b1',
            plan_id: 'plan-1',
            scheduled_date: null,
            recurrence_rule_id: null,
            order_index: 0,
            bean_name: 'Kenya',
        };
        from
            // roast_day_plans
            .mockReturnValueOnce(thenable({ data: [{ id: 'plan-1', date: '2026-08-02' }], error: null }))
            // exception rows
            .mockReturnValueOnce(thenable({ data: [], error: null }))
            // one-off batches
            .mockReturnValueOnce(thenable({ data: [oneOff], error: null }))
            // sessions
            .mockReturnValueOnce(thenable({ data: [], error: null }));

        const result = await listForDateRange('user-1', '2026-07-19', '2026-08-02');

        expect(result).toHaveLength(1);
        expect(result[0].scheduled_date).toBe('2026-08-02');
    });
});
