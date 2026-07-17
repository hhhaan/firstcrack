import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deductRoastStock } from './useDeductRoastStock';

describe('deductRoastStock integration', () => {
    let qc: QueryClient;
    const insertMany = vi.fn();
    const getBlend = vi.fn();

    beforeEach(() => {
        insertMany.mockReset();
        getBlend.mockReset();
        insertMany.mockResolvedValue(undefined);
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    });

    it('single-bean roast: insertMany receives buildRoastStockEvents payload', async () => {
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

        await deductRoastStock(
            { userId: 'user-1', qc, insertMany, getBlend },
            {
                deductionGrams: 5000,
                singleBeanId: 'bean-1',
                blendId: null,
                referenceId: 'sess-1',
            },
        );

        expect(getBlend).not.toHaveBeenCalled();
        expect(insertMany).toHaveBeenCalledWith([
            {
                user_id: 'user-1',
                bean_id: 'bean-1',
                delta_grams: -5000,
                event_type: 'roast',
                reference_id: 'sess-1',
            },
        ]);
        expect(invalidateSpy).toHaveBeenCalled();
    });

    it('blend roast: splits by component ratios into insertMany', async () => {
        getBlend.mockResolvedValue({
            name: 'House',
            blend_components: [
                { bean_id: 'a', ratio_pct: 60 },
                { bean_id: 'b', ratio_pct: 40 },
            ],
        });

        await deductRoastStock(
            { userId: 'user-1', qc, insertMany, getBlend },
            {
                deductionGrams: 1000,
                singleBeanId: null,
                blendId: 'blend-1',
                referenceId: 'sess-blend',
            },
        );

        expect(getBlend).toHaveBeenCalledWith('blend-1');
        const events = insertMany.mock.calls[0][0] as { bean_id: string; delta_grams: number }[];
        expect(events).toHaveLength(2);
        expect(events.reduce((s, e) => s + e.delta_grams, 0)).toBe(-1000);
        expect(events[0]).toMatchObject({ bean_id: 'a', delta_grams: -600 });
        expect(events[1]).toMatchObject({ bean_id: 'b', delta_grams: -400 });
    });

    it('propagates insertMany failure', async () => {
        insertMany.mockRejectedValue(new Error('db down'));

        await expect(
            deductRoastStock(
                { userId: 'user-1', qc, insertMany, getBlend },
                {
                    deductionGrams: 100,
                    singleBeanId: 'bean-1',
                    blendId: null,
                    referenceId: 'sess-err',
                },
            ),
        ).rejects.toThrow('db down');
    });
});
