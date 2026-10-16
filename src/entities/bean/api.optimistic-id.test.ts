import { beanStockEventApi } from '@entities/bean-stock-event/api';
import { OPTIMISTIC_ID_REFUSED_CODE, OptimisticIdRefusedError } from '@shared/lib/optimistic-id';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beanApi } from './api';

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
    event_type: 'purchase',
};

describe('optimistic bean ids never reach supabase', () => {
    beforeEach(() => {
        from.mockClear();
        rpc.mockClear();
    });

    it('refuses bean get, update, and delete', async () => {
        await expect(beanApi.get(OPT)).rejects.toMatchObject({
            name: 'OptimisticIdRefusedError',
            code: OPTIMISTIC_ID_REFUSED_CODE,
        });
        await expect(beanApi.update({ id: OPT, name: 'Lot' })).rejects.toBeInstanceOf(OptimisticIdRefusedError);
        await expect(beanApi.delete(OPT)).rejects.toBeInstanceOf(OptimisticIdRefusedError);
        expect(from).not.toHaveBeenCalled();
        expect(rpc).not.toHaveBeenCalled();
    });

    it('skips stock reads and refuses stock writes', async () => {
        await expect(beanStockEventApi.listByBean(OPT)).resolves.toEqual([]);
        await expect(beanStockEventApi.getStockSummary(OPT)).resolves.toMatchObject({ currentGrams: 0 });
        await expect(beanStockEventApi.insert(stockWrite)).rejects.toThrow(/unsaved bean id/);
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
