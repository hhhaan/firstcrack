import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: { from: (...args: unknown[]) => from(...args) },
}));
vi.mock('./list-for-date-range', () => ({ listForDateRange: vi.fn() }));
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

function deferred<T>() {
    let resolve = (_value: T) => {};
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
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

    it.each([undefined, 7])('inserts exact defaults with order_index %s when no conflict', async (orderIndex) => {
        const row = { ...patch, id: 'batch-1' };
        const insertQ = chainable({ data: row, error: null });
        from.mockReturnValueOnce(insertQ);

        await expect(planBatchApi.updateSingle(patch.id, { ...patch, order_index: orderIndex }, meta)).resolves.toEqual(
            row,
        );
        expect(insertQ.insert).toHaveBeenCalledWith({
            plan_id: 'plan-1',
            recurrence_rule_id: 'rule-1',
            scheduled_date: '2026-07-06',
            original_date: '2026-07-06',
            exception_type: 'modified',
            bean_name: 'Kenya',
            batch_size_kg: 5,
            target_roasted_kg: 10,
            machine_id: null,
            bean_id: null,
            blend_id: null,
            roast_profile_id: null,
            batch_type: 'Single Origin',
            notes: '',
            yield_pct: 0.82,
            order_index: orderIndex ?? 0,
            status: 'pending',
            green_lot: '',
        });
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('updates the existing exception on 23505', async () => {
        const existing = { id: 'batch-1', bean_name: 'Kenya' };
        const updateQ = chainable({ data: existing, error: null });
        from.mockReturnValueOnce(
            chainable({ data: null, error: { code: '23505', message: 'duplicate key' } }),
        ).mockReturnValueOnce(updateQ);

        await expect(planBatchApi.updateSingle(patch.id, patch, meta)).resolves.toEqual(existing);
        expect(updateQ.update).toHaveBeenCalledWith({
            plan_id: 'plan-1',
            bean_name: 'Kenya',
            batch_size_kg: 5,
            target_roasted_kg: 10,
            scheduled_date: '2026-07-06',
            exception_type: 'modified',
        });
        expect(updateQ.eq).toHaveBeenCalledWith('recurrence_rule_id', 'rule-1');
        expect(updateQ.eq).toHaveBeenCalledWith('original_date', '2026-07-06');
        expect(from).toHaveBeenCalledTimes(2);
    });

    it('rethrows other insert errors', async () => {
        const err = { code: '42501', message: 'permission denied' };
        from.mockReturnValueOnce(chainable({ data: null, error: err }));

        await expect(planBatchApi.updateSingle(patch.id, patch, meta)).rejects.toBe(err);
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('uses absent plan/date fallbacks and keeps nulls while stripping only id, batch_count and undefined', async () => {
        const explicitPatch = {
            id: patch.id,
            batch_count: 9,
            notes: undefined,
            machine_id: null,
            bean_id: null,
            blend_id: null,
            roast_profile_id: null,
            original_date: 'caller-original-date',
            exception_type: 'cancelled',
            extra: 'keep-runtime-key',
            order_index: 7,
        };
        const insertQ = chainable({ data: null, error: { code: '23505' } });
        const updateQ = chainable({ data: null, error: null });
        from.mockReturnValueOnce(insertQ).mockReturnValueOnce(updateQ);

        await expect(planBatchApi.updateSingle(patch.id, explicitPatch, meta)).resolves.toBeNull();

        expect(insertQ.insert).toHaveBeenCalledWith(
            expect.objectContaining({
                plan_id: '',
                scheduled_date: meta.originalDate,
                notes: '',
                machine_id: null,
                bean_id: null,
                blend_id: null,
                roast_profile_id: null,
                order_index: 7,
            }),
        );
        expect(insertQ.insert.mock.calls[0][0]).not.toHaveProperty('id');
        expect(insertQ.insert.mock.calls[0][0]).not.toHaveProperty('batch_count');
        expect(insertQ.insert.mock.calls[0][0]).not.toHaveProperty('extra');
        expect(updateQ.update).toHaveBeenCalledWith({
            machine_id: null,
            bean_id: null,
            blend_id: null,
            roast_profile_id: null,
            original_date: 'caller-original-date',
            exception_type: 'modified',
            extra: 'keep-runtime-key',
            order_index: 7,
            plan_id: '',
            scheduled_date: meta.originalDate,
        });
    });

    it('propagates the same conflict update error', async () => {
        const error = { code: 'PGRST116', message: 'no row' };
        from.mockReturnValueOnce(chainable({ data: null, error: { code: '23505' } })).mockReturnValueOnce(
            chainable({ data: null, error }),
        );

        await expect(planBatchApi.updateSingle(patch.id, patch, meta)).rejects.toBe(error);
        expect(from).toHaveBeenCalledTimes(2);
    });

    it.each([null, { code: '42501', message: 'insert denied' }])(
        'does not enumerate extra patch properties when insert finishes with %j',
        async (error) => {
            const getExtra = vi.fn(() => {
                throw new Error('must not enumerate');
            });
            const lazyPatch = { id: patch.id, notes: 'explicit' };
            Object.defineProperty(lazyPatch, 'extra', { enumerable: true, get: getExtra });
            from.mockReturnValueOnce(chainable({ data: null, error }));

            const pending = planBatchApi.updateSingle(patch.id, lazyPatch, meta);
            if (error) await expect(pending).rejects.toBe(error);
            else await expect(pending).resolves.toBeNull();
            expect(getExtra).not.toHaveBeenCalled();
            expect(from).toHaveBeenCalledTimes(1);
        },
    );

    it('reads the latest patch only after the awaited insert conflicts', async () => {
        const insert = deferred<Result>();
        const getExtra = vi.fn(() => 'extra-value');
        const changingPatch = { id: patch.id, plan_id: 'plan-1', notes: 'before' };
        Object.defineProperty(changingPatch, 'extra', { enumerable: true, get: getExtra });
        const insertQ = chainable({ data: null, error: null });
        insertQ.single.mockReturnValueOnce(insert.promise);
        const updateQ = chainable({ data: null, error: null });
        from.mockReturnValueOnce(insertQ).mockReturnValueOnce(updateQ);

        const pending = planBatchApi.updateSingle(patch.id, changingPatch, meta);
        expect(insertQ.single).toHaveBeenCalledOnce();
        expect(getExtra).not.toHaveBeenCalled();
        expect(updateQ.update).not.toHaveBeenCalled();
        changingPatch.notes = 'after';
        insert.resolve({ data: null, error: { code: '23505' } });

        await expect(pending).resolves.toBeNull();
        expect(getExtra).toHaveBeenCalledTimes(1);
        expect(updateQ.update).toHaveBeenCalledWith({
            notes: 'after',
            extra: 'extra-value',
            plan_id: 'plan-1',
            scheduled_date: meta.originalDate,
            exception_type: 'modified',
        });
    });

    it('updates one-off rows directly with the untouched patch', async () => {
        const row = { id: 'one-off' };
        const updateQ = chainable({ data: row, error: null });
        from.mockReturnValueOnce(updateQ);

        await expect(planBatchApi.updateSingle('one-off', patch)).resolves.toEqual(row);
        expect(updateQ.insert).not.toHaveBeenCalled();
        expect(updateQ.update).toHaveBeenCalledWith(patch);
        expect(updateQ.eq).toHaveBeenCalledWith('id', 'one-off');
        expect(from).toHaveBeenCalledTimes(1);
    });
});
