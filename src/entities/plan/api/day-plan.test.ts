import { beforeEach, expect, it, vi } from 'vitest';

const from = vi.fn();
vi.mock('@shared/lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => from(...args) } }));

import { dayPlanApi } from './day-plan';

function query(data: unknown, error: unknown = null) {
    const q = { select: vi.fn(), eq: vi.fn(), insert: vi.fn(), maybeSingle: vi.fn(), single: vi.fn() };
    for (const key of ['select', 'eq', 'insert'] as const) q[key].mockReturnValue(q);
    q.maybeSingle.mockResolvedValue({ data, error });
    q.single.mockResolvedValue({ data, error });
    return q;
}
beforeEach(() => from.mockReset());
it('reads the concurrent day-plan insert winner without replacing it', async () => {
    const winner = { id: 'existing', user_id: 'owner', date: '2026-09-01', notes: 'keep' };
    from.mockReturnValueOnce(query(null))
        .mockReturnValueOnce(query(null, { code: '23505' }))
        .mockReturnValueOnce(query(winner));
    expect(await dayPlanApi.getOrCreate('owner', '2026-09-01')).toEqual(winner);
});
it('preserves read failures rather than treating inaccessible plans as missing', async () => {
    const error = { code: '42501' };
    from.mockReturnValueOnce(query(null, error));
    await expect(dayPlanApi.getOrCreate('owner', '2026-09-01')).rejects.toEqual(error);
    expect(from).toHaveBeenCalledTimes(1);
});
