import { OPTIMISTIC_ID_REFUSED_CODE, OptimisticIdRefusedError } from '@shared/lib/optimistic-id';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beanStockEventApi } from './api';

const { from, rpc } = vi.hoisted(() => ({
    from: vi.fn(() => {
        throw new Error('supabase.from');
    }),
    rpc: vi.fn(() => {
        throw new Error('supabase.rpc');
    }),
}));

vi.mock('@shared/lib/supabase', () => ({
    supabase: { from, rpc },
}));

const OPT = 'opt_11111111-1111-4111-8111-111111111111';

const stockWrite = {
    user_id: 'user-1',
    bean_id: OPT,
    delta_grams: 1000,
    event_type: 'purchase' as const,
};

describe('optimistic bean ids never reach stock supabase calls', () => {
    beforeEach(() => {
        from.mockClear();
        rpc.mockClear();
    });

    it('skips stock reads and refuses stock writes', async () => {
        await expect(beanStockEventApi.listByBean(OPT)).resolves.toEqual([]);
        await expect(beanStockEventApi.getStockSummary(OPT)).resolves.toMatchObject({ currentGrams: 0 });
        await expect(beanStockEventApi.insert(stockWrite)).rejects.toMatchObject({
            name: 'OptimisticIdRefusedError',
            code: OPTIMISTIC_ID_REFUSED_CODE,
        });
        await expect(beanStockEventApi.insert(stockWrite)).rejects.toBeInstanceOf(OptimisticIdRefusedError);
        await expect(beanStockEventApi.insertMany([stockWrite])).rejects.toThrow(/unsaved bean id/);
        await expect(
            beanStockEventApi.insertMany(
                [],
                [{ user_id: 'user-1', bean_id: OPT, delta_grams: 1, event_type: 'roast' }],
            ),
        ).rejects.toThrow(/unsaved bean id/);
        expect(from).not.toHaveBeenCalled();
        expect(rpc).not.toHaveBeenCalled();
    });
});
