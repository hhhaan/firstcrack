import { describe, expect, it } from 'vitest';
import { determineStockDeduction } from './determine-stock-deduction';

describe('determineStockDeduction', () => {
    it('returns null when no bean and no blend', () => {
        expect(
            determineStockDeduction({
                planBatchHandoff: null,
                saveWeight: 5000,
                selectedBeanId: null,
                referenceId: 'sess-1',
                handoffBeanName: null,
            }),
        ).toBeNull();
    });

    it('uses selectedBeanId for free roast with weight', () => {
        const plan = determineStockDeduction({
            planBatchHandoff: null,
            saveWeight: 5000,
            selectedBeanId: 'bean-1',
            referenceId: 'sess-1',
            handoffBeanName: 'Ethiopia',
        });
        expect(plan).toEqual({
            deductionGrams: 5000,
            singleBeanId: 'bean-1',
            blendId: null,
            referenceId: 'sess-1',
            beanName: 'Ethiopia',
            canDeduct: true,
        });
    });

    it('prefers plan batch size over save weight', () => {
        const plan = determineStockDeduction({
            planBatchHandoff: {
                planBatchId: 'pb-1',
                planId: 'p-1',
                beanId: 'bean-1',
                blendId: null,
                beanName: 'Colombia',
                batchSizeKg: 12,
                profileId: null,
                batchCount: 1,
                completedSessions: 0,
            },
            saveWeight: 1000,
            selectedBeanId: 'bean-1',
            referenceId: 'sess-2',
            handoffBeanName: null,
        });
        expect(plan?.deductionGrams).toBe(12000);
        expect(plan?.beanName).toBe('Colombia');
    });

    it('allows blend-only deduct without selectedBeanId', () => {
        const plan = determineStockDeduction({
            planBatchHandoff: {
                planBatchId: 'pb-2',
                planId: 'p-1',
                beanId: null,
                blendId: 'blend-1',
                beanName: 'House Blend',
                batchSizeKg: 10,
                profileId: null,
                batchCount: 1,
                completedSessions: 0,
            },
            saveWeight: 0,
            selectedBeanId: null,
            referenceId: 'sess-3',
            handoffBeanName: null,
        });
        expect(plan).toMatchObject({
            deductionGrams: 10000,
            blendId: 'blend-1',
            singleBeanId: null,
            canDeduct: true,
        });
    });

    it('returns null when weight is zero and no plan batch size', () => {
        expect(
            determineStockDeduction({
                planBatchHandoff: null,
                saveWeight: 0,
                selectedBeanId: 'bean-1',
                referenceId: 'sess-4',
                handoffBeanName: null,
            }),
        ).toBeNull();
    });
});
