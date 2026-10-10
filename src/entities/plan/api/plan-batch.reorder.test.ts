import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { planBatchApi } from './plan-batch';

describe('planBatchApi.reorder', () => {
    beforeEach(() => rpc.mockReset());

    it('skips an empty order', async () => {
        await planBatchApi.reorder('plan-1', []);
        expect(rpc).not.toHaveBeenCalled();
    });

    it('sends one scoped RPC for every ordered id', async () => {
        rpc.mockResolvedValue({ error: null });
        await planBatchApi.reorder('plan-1', ['batch-2', 'batch-1']);
        expect(rpc).toHaveBeenCalledOnce();
        expect(rpc).toHaveBeenCalledWith('reorder_plan_batches', {
            p_plan_id: 'plan-1',
            p_ordered_ids: ['batch-2', 'batch-1'],
        });
    });

    it('propagates an atomic reorder failure', async () => {
        const error = { code: '22023', message: 'batch not found in plan' };
        rpc.mockResolvedValue({ error });
        await expect(planBatchApi.reorder('plan-1', ['batch-1'])).rejects.toEqual(error);
    });
});
