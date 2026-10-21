import { beforeEach, expect, it, vi } from 'vitest';

const from = vi.fn();
vi.mock('@shared/lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => from(...args) } }));

import { startForRoast, syncRoastProgress } from './resolve-for-roast';

const id = '11111111-1111-4111-8111-111111111111';
const batch = {
    id,
    plan_id: 'plan',
    status: 'pending',
    recurrence_rule_id: null,
    exception_type: null,
    batch_count: 2,
    bean_id: 'bean-1',
    blend_id: null,
    updated_at: 'revision',
};
const source = {
    planBatchId: id,
    planId: 'stale',
    beanId: null,
    blendId: null,
    beanName: '',
    batchSizeKg: 1,
    profileId: null,
    batchCount: 1,
    completedSessions: 0,
};
function query(data: unknown, error: unknown = null, count: number | null = null) {
    const result = { data, error, count };
    const q = Object.assign(Promise.resolve(result), {
        select: vi.fn(),
        eq: vi.fn(),
        or: vi.fn(),
        update: vi.fn(),
        maybeSingle: vi.fn(),
        single: vi.fn(),
    });
    for (const key of ['select', 'eq', 'or', 'update'] as const) q[key].mockReturnValue(q);
    q.maybeSingle.mockResolvedValue(result);
    q.single.mockResolvedValue(result);
    return q;
}
beforeEach(() => from.mockReset());
it('start uses fresh counts and writes only status with a revision guard', async () => {
    const update = query({ ...batch, status: 'in-progress' });
    from.mockReturnValueOnce(query(batch))
        .mockReturnValueOnce(query({ user_id: 'owner' }))
        .mockReturnValueOnce(query(null, null, 1))
        .mockReturnValueOnce(update);
    expect((await startForRoast('owner', source)).completed_sessions).toBe(1);
    expect(update.update).toHaveBeenCalledWith({ status: 'in-progress' });
    expect(update.eq).toHaveBeenCalledWith('updated_at', 'revision');
    expect(update.eq).toHaveBeenCalledWith('status', 'pending');
    expect(update.or).toHaveBeenCalledWith('exception_type.is.null,exception_type.neq.cancelled');
});
it('start rejects exhausted batches without a status write', async () => {
    from.mockReturnValueOnce(query(batch))
        .mockReturnValueOnce(query({ user_id: 'owner' }))
        .mockReturnValueOnce(query(null, null, 2));
    await expect(startForRoast('owner', source)).rejects.toThrow(/completed/);
    expect(from).toHaveBeenCalledTimes(3);
});
it('rejects a legacy batch without a bean or blend before changing its status', async () => {
    from.mockReturnValueOnce(query({ ...batch, bean_id: null }))
        .mockReturnValueOnce(query({ user_id: 'owner' }))
        .mockReturnValueOnce(query(null, null, 0));
    await expect(startForRoast('owner', { ...source, beanId: 'stale-bean' })).rejects.toMatchObject({
        code: 'unresolvable_plan_batch_id',
    });
    expect(from).toHaveBeenCalledTimes(3);
});
it('joins a start that already won the revision check', async () => {
    const lost = query(null);
    const latest = query({ ...batch, status: 'in-progress', updated_at: 'next' });
    from.mockReturnValueOnce(query(batch))
        .mockReturnValueOnce(query({ user_id: 'owner' }))
        .mockReturnValueOnce(query(null, null, 0))
        .mockReturnValueOnce(lost)
        .mockReturnValueOnce(latest);
    await expect(startForRoast('owner', source)).resolves.toMatchObject({
        status: 'in-progress',
        completed_sessions: 0,
    });
    expect(lost.maybeSingle).toHaveBeenCalled();
});
it('still fails when the revision misses and the row did not start', async () => {
    from.mockReturnValueOnce(query(batch))
        .mockReturnValueOnce(query({ user_id: 'owner' }))
        .mockReturnValueOnce(query(null, null, 0))
        .mockReturnValueOnce(query(null))
        .mockReturnValueOnce(query(batch));
    await expect(startForRoast('owner', source)).rejects.toThrow(/changed/);
});
it('sends one status write when the same start overlaps', async () => {
    const update = query({ ...batch, status: 'in-progress' });
    from.mockReturnValueOnce(query(batch))
        .mockReturnValueOnce(query({ user_id: 'owner' }))
        .mockReturnValueOnce(query(null, null, 0))
        .mockReturnValueOnce(update);
    const first = startForRoast('owner', source);
    const second = startForRoast('owner', source);
    expect(second).toBe(first);
    await first;
    expect(update.update).toHaveBeenCalledTimes(1);
});
it('allows a valid blend with no single bean', async () => {
    const blendBatch = { ...batch, bean_id: null, blend_id: 'blend-1' };
    const update = query({ ...blendBatch, status: 'in-progress' });
    from.mockReturnValueOnce(query(blendBatch))
        .mockReturnValueOnce(query({ user_id: 'owner' }))
        .mockReturnValueOnce(query(null, null, 0))
        .mockReturnValueOnce(update);
    await startForRoast('owner', source);
    expect(update.update).toHaveBeenCalledWith({ status: 'in-progress' });
});
it('recovery sync uses absolute count and never increments retries', async () => {
    for (let i = 0; i < 2; i++) {
        from.mockReturnValueOnce(query(batch))
            .mockReturnValueOnce(query({ user_id: 'owner' }))
            .mockReturnValueOnce(query(null, null, 1));
        expect((await syncRoastProgress('owner', id)).completed_sessions).toBe(1);
    }
    expect(from).toHaveBeenCalledTimes(6);
});
it('recovery does not revive cancelled exceptions', async () => {
    from.mockReturnValueOnce(query({ ...batch, exception_type: 'cancelled' }))
        .mockReturnValueOnce(query({ user_id: 'owner' }))
        .mockReturnValueOnce(query(null, null, 2));
    expect((await syncRoastProgress('owner', id)).exception_type).toBe('cancelled');
    expect(from).toHaveBeenCalledTimes(3);
});

it('uses exact server count beyond the API row cap', async () => {
    const countQuery = query(null, null, 1501);
    from.mockReturnValueOnce(query({ ...batch, status: 'done' }))
        .mockReturnValueOnce(query({ user_id: 'owner' }))
        .mockReturnValueOnce(countQuery);
    expect((await syncRoastProgress('owner', id)).completed_sessions).toBe(1501);
    expect(countQuery.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
});
it('does not treat a missing count as zero', async () => {
    from.mockReturnValueOnce(query(batch))
        .mockReturnValueOnce(query({ user_id: 'owner' }))
        .mockReturnValueOnce(query(null));
    await expect(syncRoastProgress('owner', id)).rejects.toThrow(/count unavailable/);
});
