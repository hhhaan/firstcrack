import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { describe, expect, it, vi } from 'vitest';
import { stockBeanIdsForPlanBatch } from './plan-batch-stock-ids';

const baseBatch = (over: Partial<PlanBatchWithProgress> = {}): PlanBatchWithProgress =>
    ({
        id: 'pb-1',
        bean_id: null,
        blend_id: null,
        ...over,
    }) as PlanBatchWithProgress;

describe('stockBeanIdsForPlanBatch', () => {
    it('returns single bean id for SO batches', async () => {
        await expect(stockBeanIdsForPlanBatch(baseBatch({ bean_id: 'bean-a' }))).resolves.toEqual(['bean-a']);
    });

    it('returns component bean ids for blend batches', async () => {
        const getBlend = vi.fn().mockResolvedValue({
            blend_components: [{ bean_id: 'b1' }, { bean_id: 'b2' }, { bean_id: 'b1' }],
        });
        await expect(stockBeanIdsForPlanBatch(baseBatch({ blend_id: 'blend-1' }), getBlend)).resolves.toEqual([
            'b1',
            'b2',
        ]);
    });
});
