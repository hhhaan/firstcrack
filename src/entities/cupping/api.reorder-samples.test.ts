import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { cuppingApi } from './api';

describe('cuppingApi.reorderSamples', () => {
    beforeEach(() => rpc.mockReset());

    it('skips an empty order', async () => {
        await cuppingApi.reorderSamples('event-1', []);
        expect(rpc).not.toHaveBeenCalled();
    });

    it('sends one event-scoped RPC and propagates failure', async () => {
        rpc.mockResolvedValueOnce({ error: null });
        await cuppingApi.reorderSamples('event-1', ['sample-2', 'sample-1']);
        expect(rpc).toHaveBeenCalledWith('reorder_cupping_samples', {
            p_event_id: 'event-1',
            p_ordered_ids: ['sample-2', 'sample-1'],
        });

        const error = { code: '22023', message: 'sample not found in event' };
        rpc.mockResolvedValueOnce({ error });
        await expect(cuppingApi.reorderSamples('event-1', ['sample-1'])).rejects.toEqual(error);
    });
});
