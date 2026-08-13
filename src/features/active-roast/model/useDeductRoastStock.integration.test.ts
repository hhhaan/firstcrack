import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deductRoastStock } from './useDeductRoastStock';

describe('deductRoastStock integration', () => {
    let qc: QueryClient;
    const insertMany = vi.fn();
    const getBlend = vi.fn();
    const computeInventoryAlerts = vi.fn();

    beforeEach(() => {
        insertMany.mockReset();
        getBlend.mockReset();
        computeInventoryAlerts.mockReset();
        insertMany.mockResolvedValue(undefined);
        computeInventoryAlerts.mockResolvedValue(undefined);
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    });

    it('single-bean roast: insertMany receives green + roasted estimate inbound', async () => {
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

        await deductRoastStock(
            { userId: 'user-1', qc, insertMany, getBlend, computeInventoryAlerts },
            {
                deductionGrams: 5000,
                singleBeanId: 'bean-1',
                blendId: null,
                referenceId: 'sess-1',
            },
        );
        expect(computeInventoryAlerts).toHaveBeenCalledWith('user-1');

        expect(getBlend).not.toHaveBeenCalled();
        expect(insertMany).toHaveBeenCalledWith(
            [
                {
                    user_id: 'user-1',
                    bean_id: 'bean-1',
                    delta_grams: -5000,
                    event_type: 'roast',
                    reference_id: 'sess-1',
                },
            ],
            [
                {
                    user_id: 'user-1',
                    bean_id: 'bean-1',
                    blend_id: null,
                    delta_grams: 4100, // 5000 * 0.82 DEFAULT_SHRINK
                    event_type: 'roast_inbound',
                    reference_id: 'sess-1',
                    is_estimate: true,
                },
            ],
        );
        expect(invalidateSpy).toHaveBeenCalled();
    });

    it('blend roast: splits green by ratios and roasted inbound on blend', async () => {
        getBlend.mockResolvedValue({
            name: 'House',
            blend_components: [
                { bean_id: 'a', ratio_pct: 60 },
                { bean_id: 'b', ratio_pct: 40 },
            ],
        });

        await deductRoastStock(
            { userId: 'user-1', qc, insertMany, getBlend, computeInventoryAlerts },
            {
                deductionGrams: 1000,
                singleBeanId: null,
                blendId: 'blend-1',
                referenceId: 'sess-blend',
            },
        );

        expect(getBlend).toHaveBeenCalledWith('blend-1');
        const green = insertMany.mock.calls[0][0] as { bean_id: string; delta_grams: number }[];
        const roasted = insertMany.mock.calls[0][1] as { blend_id: string | null; delta_grams: number }[];
        expect(green).toHaveLength(2);
        expect(green.reduce((s, e) => s + e.delta_grams, 0)).toBe(-1000);
        expect(green[0]).toMatchObject({ bean_id: 'a', delta_grams: -600 });
        expect(green[1]).toMatchObject({ bean_id: 'b', delta_grams: -400 });
        expect(roasted).toHaveLength(1);
        expect(roasted[0]).toMatchObject({
            blend_id: 'blend-1',
            bean_id: null,
            delta_grams: 820,
            event_type: 'roast_inbound',
            is_estimate: true,
        });
    });

    it('uses roastLevel shrink factor for roasted inbound', async () => {
        await deductRoastStock(
            { userId: 'user-1', qc, insertMany, getBlend, computeInventoryAlerts },
            {
                deductionGrams: 5000,
                singleBeanId: 'bean-1',
                blendId: null,
                referenceId: 'batch-1',
                roastLevel: 'Light',
            },
        );

        const roasted = insertMany.mock.calls[0][1] as { delta_grams: number }[];
        expect(roasted[0].delta_grams).toBe(4400); // 5000 * 0.88
    });

    it('propagates insertMany failure', async () => {
        insertMany.mockRejectedValue(new Error('db down'));

        await expect(
            deductRoastStock(
                { userId: 'user-1', qc, insertMany, getBlend, computeInventoryAlerts },
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
