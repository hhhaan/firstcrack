import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => from(...args),
    },
}));

// plan-batch imports list/materialize/recurrence — stub heavy deps
vi.mock('./list-for-date-range', () => ({ listForDateRange: vi.fn() }));
vi.mock('./materialize', () => ({ materializePlanBatch: vi.fn() }));
vi.mock('./recurrence-rule', () => ({
    recurrenceRuleApi: {},
    mergeRecurrenceRuleMaster: vi.fn(),
}));

import { planBatchApi } from './plan-batch';

type Result = { data: unknown; error: unknown };

/** Supabase builder: chain methods hang off a real Promise (await insert/update without single). */
function chainable(result: Result) {
    const q = Promise.resolve(result) as Promise<Result> & Record<string, ReturnType<typeof vi.fn>>;
    for (const m of ['insert', 'update', 'select', 'eq', 'delete']) {
        q[m] = vi.fn(() => q);
    }
    q.single = vi.fn(() => Promise.resolve(result));
    return q;
}

const meta = {
    recurrenceRuleId: 'rule-1',
    originalDate: '2026-07-06',
    planId: 'plan-1',
};

describe('planBatchApi.deleteSingle', () => {
    beforeEach(() => {
        from.mockReset();
    });

    it('inserts cancelled exception when no conflict', async () => {
        const insertQ = chainable({ data: null, error: null });
        from.mockReturnValueOnce(insertQ);

        await expect(planBatchApi.deleteSingle('virtual:rule-1:2026-07-06', meta)).resolves.toBeUndefined();

        expect(insertQ.insert).toHaveBeenCalledWith(
            expect.objectContaining({
                plan_id: 'plan-1',
                recurrence_rule_id: 'rule-1',
                scheduled_date: '2026-07-06',
                original_date: '2026-07-06',
                exception_type: 'cancelled',
                bean_name: '__cancelled__',
            }),
        );
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('converges existing exception to cancelled on 23505', async () => {
        const insertQ = chainable({ data: null, error: { code: '23505', message: 'duplicate key' } });
        const updateQ = chainable({ data: null, error: null });
        from.mockReturnValueOnce(insertQ).mockReturnValueOnce(updateQ);

        await expect(planBatchApi.deleteSingle('batch-1', meta)).resolves.toBeUndefined();

        expect(updateQ.update).toHaveBeenCalledWith({
            exception_type: 'cancelled',
            bean_name: '__cancelled__',
            plan_id: 'plan-1',
        });
        expect(updateQ.eq).toHaveBeenCalledWith('recurrence_rule_id', 'rule-1');
        expect(updateQ.eq).toHaveBeenCalledWith('original_date', '2026-07-06');
    });

    it('rethrows non-23505 insert errors without updating', async () => {
        const err = { code: '42501', message: 'permission denied' };
        from.mockReturnValueOnce(chainable({ data: null, error: err }));

        await expect(planBatchApi.deleteSingle('batch-1', meta)).rejects.toEqual(err);
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('rethrows update errors on the conflict path', async () => {
        const updateErr = { code: 'PGRST116', message: 'no rows' };
        from.mockReturnValueOnce(
            chainable({ data: null, error: { code: '23505', message: 'dup' } }),
        ).mockReturnValueOnce(chainable({ data: null, error: updateErr }));

        await expect(planBatchApi.deleteSingle('batch-1', meta)).rejects.toEqual(updateErr);
    });

    it('deletes one-off batch by id when no recurrence meta', async () => {
        const deleteQ = chainable({ data: null, error: null });
        from.mockReturnValueOnce(deleteQ);

        await expect(planBatchApi.deleteSingle('one-off-1')).resolves.toBeUndefined();
        expect(deleteQ.delete).toHaveBeenCalled();
        expect(deleteQ.eq).toHaveBeenCalledWith('id', 'one-off-1');
    });
});
