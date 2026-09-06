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

import type { RecurrenceRule } from '@shared/types/database.types';
import { listForDateRange } from './list-for-date-range';
import { recurrenceRuleApi } from './recurrence-rule';

type Result = { data: unknown; error: unknown };

/** Supabase builder: chainable filter methods, awaitable (thenable) result. */
function thenable(result: Result) {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'not', 'is', 'in', 'or']) {
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

    it('fetches exceptions by scheduled_date OR original_date in range', async () => {
        const exceptionQ = thenable({ data: [], error: null });
        from.mockReturnValueOnce(thenable({ data: [], error: null })).mockReturnValueOnce(exceptionQ);

        await listForDateRange('user-1', '2026-07-19', '2026-08-02');

        expect(exceptionQ.or).toHaveBeenCalledWith(
            expect.stringMatching(/scheduled_date\.gte\.2026-07-19.*original_date\.gte\.2026-07-19/),
        );
        expect(exceptionQ.gte).not.toHaveBeenCalled();
    });

    it('moved exception suppresses the original-day virtual instance', async () => {
        vi.mocked(recurrenceRuleApi.listActive).mockResolvedValueOnce([
            {
                id: 'rule-1',
                rrule: 'FREQ=WEEKLY',
                dtstart: '2026-07-06',
                until: null,
                status: 'active',
                bean_name: 'Kenya',
                bean_id: null,
                blend_id: null,
                batch_type: 'Single Origin',
                batch_size_kg: 5,
                target_roasted_kg: 4,
                yield_pct: 0.82,
                machine_id: null,
                roast_profile_id: null,
                notes: '',
                green_lot: '',
                user_id: 'user-1',
                created_at: '2026-07-01T00:00:00Z',
                updated_at: '2026-07-01T00:00:00Z',
            } as RecurrenceRule,
        ]);
        const moved = {
            id: 'ex-1',
            recurrence_rule_id: 'rule-1',
            original_date: '2026-07-06',
            scheduled_date: '2026-07-08',
            exception_type: 'modified',
            bean_name: 'Kenya',
            rrule: null,
            plan_id: 'plan-b',
            order_index: 0,
        };
        from.mockReturnValueOnce(thenable({ data: [], error: null }))
            .mockReturnValueOnce(thenable({ data: [moved], error: null }))
            .mockReturnValueOnce(thenable({ data: [], error: null }));

        const originalDay = await listForDateRange('user-1', '2026-07-06', '2026-07-06');
        expect(originalDay).toHaveLength(0);

        vi.mocked(recurrenceRuleApi.listActive).mockResolvedValueOnce([
            {
                id: 'rule-1',
                rrule: 'FREQ=WEEKLY',
                dtstart: '2026-07-06',
                until: null,
                status: 'active',
                bean_name: 'Kenya',
                bean_id: null,
                blend_id: null,
                batch_type: 'Single Origin',
                batch_size_kg: 5,
                target_roasted_kg: 4,
                yield_pct: 0.82,
                machine_id: null,
                roast_profile_id: null,
                notes: '',
                green_lot: '',
                user_id: 'user-1',
                created_at: '2026-07-01T00:00:00Z',
                updated_at: '2026-07-01T00:00:00Z',
            } as RecurrenceRule,
        ]);
        from.mockReturnValueOnce(thenable({ data: [], error: null }))
            .mockReturnValueOnce(thenable({ data: [moved], error: null }))
            .mockReturnValueOnce(thenable({ data: [], error: null }));

        const newDay = await listForDateRange('user-1', '2026-07-08', '2026-07-08');
        expect(newDay).toHaveLength(1);
        expect(newDay[0].id).toBe('ex-1');
        expect(newDay[0].scheduled_date).toBe('2026-07-08');
    });
});
