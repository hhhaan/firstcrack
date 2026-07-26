import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => from(...args),
    },
}));

vi.mock('./day-plan', () => ({
    dayPlanApi: {
        getOrCreate: vi.fn(async () => ({ id: 'plan-1' })),
    },
}));

import { materializePlanBatch } from './materialize';

type Result = { data: unknown; error: unknown };

/** Supabase builder: chainable methods, single() resolves the result. */
function chainable(result: Result) {
    const q: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const m of ['insert', 'update', 'select', 'eq']) {
        q[m] = vi.fn(() => q);
    }
    q.single = vi.fn(() => Promise.resolve(result));
    return q;
}

const args = ['user-1', 'rule-1', '2026-07-13', '2026-07-06'] as const;

describe('materializePlanBatch', () => {
    beforeEach(() => {
        from.mockReset();
    });

    it('returns inserted row when no conflict', async () => {
        const row = { id: 'batch-1' };
        const insertQ = chainable({ data: row, error: null });
        from.mockReturnValueOnce(insertQ);

        await expect(materializePlanBatch(...args, { bean_name: 'Kenya' })).resolves.toEqual(row);
        expect(insertQ.insert).toHaveBeenCalledWith(
            expect.objectContaining({
                plan_id: 'plan-1',
                recurrence_rule_id: 'rule-1',
                scheduled_date: '2026-07-13',
                original_date: '2026-07-06',
                exception_type: 'modified',
                bean_name: 'Kenya',
            }),
        );
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('converges to existing row via update on 23505', async () => {
        const existing = { id: 'batch-1', bean_name: 'Kenya' };
        const insertQ = chainable({ data: null, error: { code: '23505', message: 'duplicate key' } });
        const updateQ = chainable({ data: existing, error: null });
        from.mockReturnValueOnce(insertQ).mockReturnValueOnce(updateQ);

        await expect(materializePlanBatch(...args, { bean_name: 'Kenya', status: undefined })).resolves.toEqual(
            existing,
        );

        // Only defined patch fields + scheduling context — no default resets (yield_pct, notes, ...)
        expect(updateQ.update).toHaveBeenCalledWith({
            bean_name: 'Kenya',
            plan_id: 'plan-1',
            scheduled_date: '2026-07-13',
            exception_type: 'modified',
        });
        expect(updateQ.eq).toHaveBeenCalledWith('recurrence_rule_id', 'rule-1');
        expect(updateQ.eq).toHaveBeenCalledWith('original_date', '2026-07-06');
    });

    it('rethrows non-23505 insert errors without updating', async () => {
        const err = { code: '42501', message: 'permission denied' };
        from.mockReturnValueOnce(chainable({ data: null, error: err }));

        await expect(materializePlanBatch(...args, {})).rejects.toEqual(err);
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('rethrows update errors on the conflict path', async () => {
        const updateErr = { code: 'PGRST116', message: 'no rows' };
        from.mockReturnValueOnce(
            chainable({ data: null, error: { code: '23505', message: 'dup' } }),
        ).mockReturnValueOnce(chainable({ data: null, error: updateErr }));

        await expect(materializePlanBatch(...args, {})).rejects.toEqual(updateErr);
    });
});
