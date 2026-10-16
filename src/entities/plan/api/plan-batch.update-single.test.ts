import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: { from: (...args: unknown[]) => from(...args) },
}));
vi.mock('./list-for-date-range', () => ({ listForDateRange: vi.fn() }));
vi.mock('./materialize', () => ({ materializePlanBatch: vi.fn() }));
vi.mock('./recurrence-rule', () => ({
    recurrenceRuleApi: {},
    mergeRecurrenceRuleMaster: vi.fn(),
}));
vi.mock('./session-counts', () => ({ countSessionsByBatch: vi.fn() }));

import { planBatchApi } from './plan-batch';

type Result = { data: unknown; error: unknown };

function chainable(result: Result) {
    const q = Promise.resolve(result) as Promise<Result> & Record<string, ReturnType<typeof vi.fn>>;
    for (const method of ['insert', 'update', 'select', 'eq']) {
        q[method] = vi.fn(() => q);
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
    target_roasted_kg: 10,
};

describe('planBatchApi.updateSingle virtual exception', () => {
    beforeEach(() => {
        from.mockReset();
    });

    it('inserts a modified exception when no conflict', async () => {
        const row = { id: 'batch-1', ...patch };
        const insertQ = chainable({ data: row, error: null });
        from.mockReturnValueOnce(insertQ);

        await expect(planBatchApi.updateSingle(patch.id, patch, meta)).resolves.toEqual(row);
        expect(insertQ.insert).toHaveBeenCalledWith(
            expect.objectContaining({
                plan_id: 'plan-1',
                recurrence_rule_id: 'rule-1',
                original_date: '2026-07-06',
                exception_type: 'modified',
                bean_name: 'Kenya',
            }),
        );
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('updates the existing exception on 23505', async () => {
        const existing = { id: 'batch-1', bean_name: 'Kenya' };
        from.mockReturnValueOnce(
            chainable({ data: null, error: { code: '23505', message: 'duplicate key' } }),
        ).mockReturnValueOnce(chainable({ data: existing, error: null }));

        await expect(planBatchApi.updateSingle(patch.id, patch, meta)).resolves.toEqual(existing);
        expect(from).toHaveBeenCalledTimes(2);
    });

    it('rethrows other insert errors', async () => {
        const err = { code: '42501', message: 'permission denied' };
        from.mockReturnValueOnce(chainable({ data: null, error: err }));

        await expect(planBatchApi.updateSingle(patch.id, patch, meta)).rejects.toEqual(err);
        expect(from).toHaveBeenCalledTimes(1);
    });
});
