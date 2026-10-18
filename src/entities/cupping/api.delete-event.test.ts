import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postgrestChain } from './testing/postgrest-chain';

const from = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => from(...args),
    },
}));

import { cuppingApi } from './api';

describe('cuppingApi.deleteEvent', () => {
    beforeEach(() => {
        from.mockReset();
    });

    it('throws when PostgREST deletes zero rows (RLS no-op looks like success)', async () => {
        from.mockReturnValueOnce(postgrestChain({ data: [], error: null }));

        await expect(cuppingApi.deleteEvent('ev-1')).rejects.toThrow(/CUPPING_EVENT_NOT_DELETED/);
    });

    it('resolves when the deleted row is returned', async () => {
        const q = postgrestChain({ data: [{ id: 'ev-1' }], error: null });
        from.mockReturnValueOnce(q);

        await expect(cuppingApi.deleteEvent('ev-1')).resolves.toBeUndefined();
        expect(from).toHaveBeenCalledWith('cupping_events');
        expect(q.delete).toHaveBeenCalled();
        expect(q.eq).toHaveBeenCalledWith('id', 'ev-1');
        expect(q.select).toHaveBeenCalledWith('id');
    });
});

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
        from.mockReturnValueOnce(postgrestChain({ data: endedEvent, error: null }))
            .mockReturnValueOnce(postgrestChain({ data: null, error: null }))
            .mockReturnValueOnce(postgrestChain({ data: readAfter, error: null }));

        await expect(cuppingApi.ensureResultsToken('ev-1')).resolves.toEqual(readAfter);
        expect(from).toHaveBeenCalledTimes(3);
    });
});
