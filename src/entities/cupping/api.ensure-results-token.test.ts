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

const endedEvent = {
    id: 'ev-1',
    results_token: null,
    ended_at: '2026-10-01T00:00:00Z',
};

describe('cuppingApi.ensureResultsToken', () => {
    beforeEach(() => {
        from.mockReset();
    });

    it('re-reads when the conditional update matches zero rows (no 406 from .single())', async () => {
        const readAfter = { ...endedEvent, results_token: 'existing-token' };
        from.mockReturnValueOnce(chainable({ data: endedEvent, error: null }))
            .mockReturnValueOnce(chainable({ data: null, error: null }))
            .mockReturnValueOnce(chainable({ data: readAfter, error: null }));

        await expect(cuppingApi.ensureResultsToken('ev-1')).resolves.toEqual(readAfter);
        expect(from).toHaveBeenCalledTimes(3);
    });
});
