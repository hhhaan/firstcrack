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

import { dayPlanApi } from './day-plan';
import { materializePlanBatch } from './materialize';

type Result = { data: unknown; error: unknown };

/** Supabase builder: chainable methods, single() resolves the result. */
function chainable(result: Result) {
    const q: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const m of ['insert', 'update', 'select', 'eq']) {
        q[m] = vi.fn(() => q);
    }
    q.maybeSingle = vi.fn(() => Promise.resolve(result));
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

const args = ['user-1', 'rule-1', '2026-07-13', '2026-07-06'] as const;

describe('materializePlanBatch', () => {
    beforeEach(() => {
        from.mockReset();
        vi.mocked(dayPlanApi.getOrCreate).mockClear();
    });

    it('returns inserted row when no conflict', async () => {
        const row = { id: 'batch-1' };
        const insertQ = chainable({ data: row, error: null });
        from.mockReturnValueOnce(insertQ);

        await expect(materializePlanBatch(...args, { bean_name: 'Kenya' })).resolves.toEqual(row);
        expect(insertQ.insert).toHaveBeenCalledWith({
            plan_id: 'plan-1',
            recurrence_rule_id: 'rule-1',
            scheduled_date: '2026-07-13',
            original_date: '2026-07-06',
            exception_type: 'modified',
            bean_name: 'Kenya',
            batch_size_kg: 0,
            target_roasted_kg: 0,
            machine_id: null,
            bean_id: null,
            blend_id: null,
            roast_profile_id: null,
            batch_type: 'Single Origin',
            notes: '',
            yield_pct: 0.82,
            order_index: 0,
            status: 'pending',
            green_lot: '',
        });
        expect(dayPlanApi.getOrCreate).toHaveBeenCalledWith('user-1', '2026-07-13');
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

        await expect(materializePlanBatch(...args, {})).rejects.toBe(err);
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('rethrows update errors on the conflict path', async () => {
        const updateErr = { code: 'PGRST116', message: 'no rows' };
        from.mockReturnValueOnce(
            chainable({ data: null, error: { code: '23505', message: 'dup' } }),
        ).mockReturnValueOnce(chainable({ data: null, error: updateErr }));

        await expect(materializePlanBatch(...args, {})).rejects.toBe(updateErr);
    });

    it('conflict read selects the existing row on 23505 without updating', async () => {
        const existing = { id: 'batch-1', bean_name: 'Kenya', notes: 'keep me' };
        const insertQ = chainable({ data: null, error: { code: '23505', message: 'duplicate key' } });
        const selectQ = chainable({ data: existing, error: null });
        from.mockReturnValueOnce(chainable({ data: null, error: null }))
            .mockReturnValueOnce(insertQ)
            .mockReturnValueOnce(selectQ);

        await expect(
            materializePlanBatch(...args, { bean_name: 'Kenya', notes: 'stale overwrite' }, { conflict: 'read' }),
        ).resolves.toEqual(existing);

        expect(selectQ.update).not.toHaveBeenCalled();
        expect(selectQ.eq).toHaveBeenCalledWith('recurrence_rule_id', 'rule-1');
        expect(selectQ.eq).toHaveBeenCalledWith('original_date', '2026-07-06');
    });
    it.each(['modified', 'cancelled'])(
        'read mode returns an existing %s exception before any day plan',
        async (type) => {
            const row = { id: 'existing', scheduled_date: '2026-08-01', exception_type: type };
            from.mockReturnValueOnce(chainable({ data: row, error: null }));
            expect(await materializePlanBatch(...args, { notes: 'stale' }, { conflict: 'read' })).toEqual(row);
            expect(dayPlanApi.getOrCreate).not.toHaveBeenCalled();
            expect(from).toHaveBeenCalledTimes(1);
        },
    );

    it('stops on the same pre-read error before creating a day plan', async () => {
        const error = { code: '42501', message: 'read denied' };
        from.mockReturnValueOnce(chainable({ data: null, error }));

        await expect(materializePlanBatch(...args, {}, { conflict: 'read' })).rejects.toBe(error);
        expect(dayPlanApi.getOrCreate).not.toHaveBeenCalled();
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('awaits a read miss before day-plan creation and insertion', async () => {
        const read = deferred<Result>();
        const calls: string[] = [];
        const readQ = chainable({ data: null, error: null });
        readQ.maybeSingle.mockImplementationOnce(() =>
            read.promise.then((result) => {
                calls.push('read');
                return result;
            }),
        );
        vi.mocked(dayPlanApi.getOrCreate).mockImplementationOnce(async () => {
            calls.push('day-plan');
            return { id: 'plan-1', user_id: 'user-1', date: args[2], notes: '', created_at: '', updated_at: '' };
        });
        const insertQ = chainable({ data: { id: 'batch-1' }, error: null });
        insertQ.single.mockImplementationOnce(async () => {
            calls.push('insert');
            return { data: { id: 'batch-1' }, error: null };
        });
        from.mockReturnValueOnce(readQ).mockReturnValueOnce(insertQ);

        const pending = materializePlanBatch(...args, {}, { conflict: 'read' });
        expect(dayPlanApi.getOrCreate).not.toHaveBeenCalled();
        expect(from).toHaveBeenCalledTimes(1);
        read.resolve({ data: null, error: null });

        await expect(pending).resolves.toEqual({ id: 'batch-1' });
        expect(calls).toEqual(['read', 'day-plan', 'insert']);
    });

    it('propagates the same day-plan error without an insert', async () => {
        const error = new Error('day-plan unavailable');
        vi.mocked(dayPlanApi.getOrCreate).mockRejectedValueOnce(error);

        await expect(materializePlanBatch(...args, {})).rejects.toBe(error);
        expect(from).not.toHaveBeenCalled();
    });

    it('keeps runtime extra keys and nulls only on conflict update', async () => {
        const extraPatch = {
            bean_name: 'Kenya',
            machine_id: null,
            id: 'runtime-id',
            batch_count: 3,
            order_index: 7,
            plan_id: 'stale-plan',
            scheduled_date: 'stale-date',
            exception_type: 'cancelled',
            notes: undefined,
        };
        const insertQ = chainable({ data: null, error: { code: '23505' } });
        const updateQ = chainable({ data: { id: 'batch-1' }, error: null });
        from.mockReturnValueOnce(insertQ).mockReturnValueOnce(updateQ);

        await materializePlanBatch(...args, extraPatch);

        expect(insertQ.insert).toHaveBeenCalledWith(expect.objectContaining({ order_index: 0, machine_id: null }));
        expect(insertQ.insert.mock.calls[0][0]).not.toHaveProperty('id');
        expect(insertQ.insert.mock.calls[0][0]).not.toHaveProperty('batch_count');
        expect(updateQ.update).toHaveBeenCalledWith({
            bean_name: 'Kenya',
            machine_id: null,
            id: 'runtime-id',
            batch_count: 3,
            order_index: 7,
            plan_id: 'plan-1',
            scheduled_date: '2026-07-13',
            exception_type: 'modified',
        });
    });

    it.each([null, { code: '42501', message: 'insert denied' }])(
        'does not enumerate extra patch properties when insert finishes with %j',
        async (error) => {
            const getExtra = vi.fn(() => {
                throw new Error('must not enumerate');
            });
            const lazyPatch = { notes: 'explicit' };
            Object.defineProperty(lazyPatch, 'extra', { enumerable: true, get: getExtra });
            from.mockReturnValueOnce(chainable({ data: null, error }));

            const pending = materializePlanBatch(...args, lazyPatch);
            if (error) await expect(pending).rejects.toBe(error);
            else await expect(pending).resolves.toBeNull();
            expect(getExtra).not.toHaveBeenCalled();
            expect(from).toHaveBeenCalledTimes(1);
        },
    );

    it.each([null, { code: '42501', message: 'conflict read denied' }])(
        'never enumerates or updates a read-mode conflict with result %j',
        async (error) => {
            const getExtra = vi.fn(() => {
                throw new Error('must not enumerate');
            });
            const lazyPatch = { notes: 'stale' };
            Object.defineProperty(lazyPatch, 'extra', { enumerable: true, get: getExtra });
            const readQ = chainable({ data: null, error });
            from.mockReturnValueOnce(chainable({ data: null, error: null }))
                .mockReturnValueOnce(chainable({ data: null, error: { code: '23505' } }))
                .mockReturnValueOnce(readQ);

            const pending = materializePlanBatch(...args, lazyPatch, { conflict: 'read' });
            if (error) await expect(pending).rejects.toBe(error);
            else await expect(pending).resolves.toBeNull();
            expect(getExtra).not.toHaveBeenCalled();
            expect(readQ.update).not.toHaveBeenCalled();
            expect(from).toHaveBeenCalledTimes(3);
        },
    );

    it('reads the latest patch only after the awaited insert conflicts', async () => {
        const insert = deferred<Result>();
        const started = deferred<void>();
        const getExtra = vi.fn(() => 'extra-value');
        const changingPatch = { notes: 'before' };
        Object.defineProperty(changingPatch, 'extra', { enumerable: true, get: getExtra });
        const insertQ = chainable({ data: null, error: null });
        insertQ.single.mockImplementationOnce(() => {
            started.resolve();
            return insert.promise;
        });
        const updateQ = chainable({ data: null, error: null });
        from.mockReturnValueOnce(insertQ).mockReturnValueOnce(updateQ);

        const pending = materializePlanBatch(...args, changingPatch);
        await started.promise;
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
            scheduled_date: '2026-07-13',
            exception_type: 'modified',
        });
    });
});
