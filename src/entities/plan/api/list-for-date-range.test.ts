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
import { recurrenceRuleApi } from './recurrence-rule';

type Result = { data: unknown; error: unknown };

/** Supabase builder: chainable filter methods, awaitable (thenable) result. */
function thenable(result: Result | Promise<Result>) {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'not', 'is', 'in', 'order', 'range']) {
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
        vi.mocked(recurrenceRuleApi.listActive).mockReset();
        vi.mocked(recurrenceRuleApi.listActive).mockResolvedValue([]);
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

    it('starts rule, day-plan, and exception lookups without waiting on each other', async () => {
        let resolveRules = () => {};
        vi.mocked(recurrenceRuleApi.listActive).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveRules = () => resolve([]);
            }),
        );

        const tables: string[] = [];
        from.mockImplementation((table: string) => {
            tables.push(table);
            if (table === 'roast_day_plans') {
                return thenable({ data: [], error: null });
            }
            return thenable({ data: [], error: null });
        });

        const pending = listForDateRange('user-1', '2026-07-19', '2026-08-02');
        expect(tables).toEqual(['roast_day_plans', 'roast_plan_batches']);
        resolveRules();
        await pending;
        expect(tables).toEqual(['roast_day_plans', 'roast_plan_batches']);
    });

    it('waits for day-plan ids before one-off batches, then batch ids before session counts', async () => {
        const tables: string[] = [];
        let resolvePlans: (result: Result) => void = () => {};
        from.mockImplementation((table: string) => {
            tables.push(table);
            if (table === 'roast_day_plans') {
                return thenable(
                    new Promise((resolve) => {
                        resolvePlans = resolve;
                    }),
                );
            }
            if (table === 'roast_sessions') {
                return thenable({ data: [], error: null });
            }
            return thenable({
                data:
                    table === 'roast_plan_batches' && tables.filter((t) => t === 'roast_plan_batches').length > 1
                        ? [
                              {
                                  id: 'b1',
                                  plan_id: 'plan-1',
                                  scheduled_date: null,
                                  recurrence_rule_id: null,
                                  order_index: 0,
                                  bean_name: 'Kenya',
                              },
                          ]
                        : [],
                error: null,
            });
        });

        const pending = listForDateRange('user-1', '2026-07-19', '2026-08-02');
        expect(tables).toEqual(['roast_day_plans', 'roast_plan_batches']);
        resolvePlans({ data: [{ id: 'plan-1', date: '2026-08-02' }], error: null });
        await pending;
        expect(tables).toEqual(['roast_day_plans', 'roast_plan_batches', 'roast_plan_batches', 'roast_sessions']);
    });
});
