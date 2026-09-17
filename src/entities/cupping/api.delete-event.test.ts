import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => from(...args),
    },
}));

import { cuppingApi } from './api';

type Result = { data: unknown; error: unknown };

function chainable(result: Result) {
    const q = Promise.resolve(result) as Promise<Result> & Record<string, ReturnType<typeof vi.fn>>;
    for (const m of ['insert', 'update', 'select', 'eq', 'delete', 'is', 'gt', 'order']) {
        q[m] = vi.fn(() => q);
    }
    q.single = vi.fn(() => Promise.resolve(result));
    q.maybeSingle = vi.fn(() => Promise.resolve(result));
    return q;
}

describe('cuppingApi.deleteEvent', () => {
    beforeEach(() => {
        from.mockReset();
    });

    it('throws when PostgREST deletes zero rows (RLS no-op looks like success)', async () => {
        from.mockReturnValueOnce(chainable({ data: [], error: null }));

        await expect(cuppingApi.deleteEvent('ev-1')).rejects.toThrow(/CUPPING_EVENT_NOT_DELETED/);
    });

    it('resolves when the deleted row is returned', async () => {
        const q = chainable({ data: [{ id: 'ev-1' }], error: null });
        from.mockReturnValueOnce(q);

        await expect(cuppingApi.deleteEvent('ev-1')).resolves.toBeUndefined();
        expect(from).toHaveBeenCalledWith('cupping_events');
        expect(q.delete).toHaveBeenCalled();
        expect(q.eq).toHaveBeenCalledWith('id', 'ev-1');
        expect(q.select).toHaveBeenCalledWith('id');
    });
});
