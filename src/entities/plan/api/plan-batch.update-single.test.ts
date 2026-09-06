import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => from(...args),
    },
}));

vi.mock('./list-for-date-range', () => ({ listForDateRange: vi.fn() }));
vi.mock('./materialize', () => ({ materializePlanBatch: vi.fn() }));
vi.mock('./recurrence-rule', () => ({
    recurrenceRuleApi: {},
    mergeRecurrenceRuleMaster: vi.fn(),
}));

import { planBatchApi } from './plan-batch';

type Result = { data: unknown; error: unknown };

function chainable(result: Result) {
    const q = Promise.resolve(result) as Promise<Result> & Record<string, ReturnType<typeof vi.fn>>;
    for (const m of ['insert', 'update', 'select', 'eq', 'delete']) {
        q[m] = vi.fn(() => q);
    }
    q.single = vi.fn(() => Promise.resolve(result));
    return q;
}

const meta = { recurrenceRuleId: 'rule-1', originalDate: '2026-07-06' };
const patch = {
    id: 'virtual:rule-1:2026-07-06',
    plan_id: 'plan-1',
    bean_name: 'Kenya',
    batch_size_kg: 5,
    scheduled_date: '2026-07-08',
};

describe('planBatchApi.updateSingle recurring 23505', () => {
    beforeEach(() => {
        from.mockReset();
    });

    it('returns inserted exception when no conflict', async () => {
        const row = { ...patch, id: 'batch-1' };
        const insertQ = chainable({ data: row, error: null });
        from.mockReturnValueOnce(insertQ);

        await expect(planBatchApi.updateSingle('virtual:rule-1:2026-07-06', patch, meta)).resolves.toEqual(row);
        expect(insertQ.insert).toHaveBeenCalledWith(
            expect.objectContaining({
                recurrence_rule_id: 'rule-1',
                original_date: '2026-07-06',
                scheduled_date: '2026-07-08',
                exception_type: 'modified',
                bean_name: 'Kenya',
            }),
        );
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('converges existing exception via UPDATE on 23505', async () => {
        const existing = { id: 'batch-1', bean_name: 'Kenya' };
        const insertQ = chainable({ data: null, error: { code: '23505', message: 'duplicate key' } });
        const updateQ = chainable({ data: existing, error: null });
        from.mockReturnValueOnce(insertQ).mockReturnValueOnce(updateQ);

        await expect(planBatchApi.updateSingle('virtual:rule-1:2026-07-06', patch, meta)).resolves.toEqual(existing);
        expect(updateQ.update).toHaveBeenCalledWith(
            expect.objectContaining({
                bean_name: 'Kenya',
                scheduled_date: '2026-07-08',
                exception_type: 'modified',
            }),
        );
        expect(updateQ.eq).toHaveBeenCalledWith('recurrence_rule_id', 'rule-1');
        expect(updateQ.eq).toHaveBeenCalledWith('original_date', '2026-07-06');
    });

    it('rethrows non-23505 insert errors without updating', async () => {
        const err = { code: '42501', message: 'permission denied' };
        from.mockReturnValueOnce(chainable({ data: null, error: err }));

        await expect(planBatchApi.updateSingle('virtual:x', patch, meta)).rejects.toEqual(err);
        expect(from).toHaveBeenCalledTimes(1);
    });
});
