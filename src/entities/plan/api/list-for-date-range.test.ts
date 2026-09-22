import type { RecurrenceRule } from '@shared/types/database.types';
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

const weeklyRule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule =>
    ({
        id: 'rule-1',
        rrule: 'FREQ=WEEKLY',
        dtstart: '2026-09-22',
        until: null,
        status: 'active',
        user_id: 'user-1',
        machine_id: 'm1',
        roast_profile_id: 'prof-1',
        bean_id: 'bean-1',
        bean_name: 'Ethiopia',
        blend_id: null,
        green_lot: '',
        batch_size_kg: 5,
        yield_pct: 0.82,
        target_roasted_kg: 10,
        notes: '',
        batch_type: 'Single Origin',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
        ...over,
    }) as RecurrenceRule;

describe('listForDateRange roast profile (#481)', () => {
    beforeEach(() => {
        from.mockReset();
        vi.mocked(recurrenceRuleApi.listActive).mockReset();
    });

    it('copies the series profile onto a virtual occurrence', async () => {
        vi.mocked(recurrenceRuleApi.listActive).mockResolvedValue([weeklyRule()]);
        from.mockReturnValueOnce(thenable({ data: [], error: null })).mockReturnValueOnce(
            thenable({ data: [], error: null }),
        );

        const result = await listForDateRange('user-1', '2026-09-22', '2026-09-22');

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            bean_name: 'Ethiopia',
            bean_id: 'bean-1',
            target_roasted_kg: 10,
            roast_profile_id: 'prof-1',
        });
    });

    it('keeps the series profile when this occurrence row has a null profile', async () => {
        vi.mocked(recurrenceRuleApi.listActive).mockResolvedValue([weeklyRule()]);
        const wrongRow = {
            id: 'other-row',
            recurrence_rule_id: 'other-rule',
            original_date: '2026-09-22',
            scheduled_date: '2026-09-22',
            exception_type: 'modified',
            roast_profile_id: null,
            bean_name: 'Wrong',
            bean_id: 'wrong-bean',
            target_roasted_kg: 1,
            order_index: 0,
        };
        const ethiopia = {
            id: 'ex-1',
            plan_id: 'plan-1',
            recurrence_rule_id: 'rule-1',
            original_date: '2026-09-22',
            scheduled_date: '2026-09-22',
            exception_type: 'modified',
            roast_profile_id: null,
            bean_name: 'Ethiopia',
            bean_id: 'bean-1',
            target_roasted_kg: 10,
            batch_size_kg: 5,
            order_index: 0,
            rrule: null,
        };
        from.mockReturnValueOnce(thenable({ data: [], error: null }))
            .mockReturnValueOnce(thenable({ data: [wrongRow, ethiopia], error: null }))
            .mockReturnValueOnce(thenable({ data: [], error: null }));

        const result = await listForDateRange('user-1', '2026-09-22', '2026-09-22');

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            bean_name: 'Ethiopia',
            bean_id: 'bean-1',
            target_roasted_kg: 10,
            roast_profile_id: 'prof-1',
        });
    });

    it('uses a concrete row profile when the series profile is null', async () => {
        vi.mocked(recurrenceRuleApi.listActive).mockResolvedValue([weeklyRule({ roast_profile_id: null })]);
        const row = {
            id: 'row-1',
            plan_id: 'plan-1',
            recurrence_rule_id: 'rule-1',
            original_date: '2026-09-22',
            scheduled_date: '2026-09-22',
            exception_type: null,
            roast_profile_id: 'prof-row',
            bean_name: 'Ethiopia',
            bean_id: 'bean-1',
            target_roasted_kg: 10,
            order_index: 0,
        };
        from.mockReturnValueOnce(thenable({ data: [], error: null }))
            .mockReturnValueOnce(thenable({ data: [row], error: null }))
            .mockReturnValueOnce(thenable({ data: [], error: null }));

        const result = await listForDateRange('user-1', '2026-09-22', '2026-09-22');

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            bean_name: 'Ethiopia',
            target_roasted_kg: 10,
            roast_profile_id: 'prof-row',
        });
    });
});
