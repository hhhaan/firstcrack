import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import { resolveEffectiveBatch } from '../model/useSaveRoast';
import { toPlanBatchHandoff } from './toPlanBatchHandoff';

const baseBatch = (over: Partial<PlanBatchWithProgress> = {}): PlanBatchWithProgress =>
    ({
        id: 'pb-1',
        plan_id: 'plan-1',
        bean_id: 'bean-1',
        blend_id: null,
        bean_name: 'Ethiopia',
        batch_size_kg: 12,
        roast_profile_id: 'prof-1',
        batch_count: 3,
        completed_sessions: 1,
        ...over,
    }) as PlanBatchWithProgress;

describe('toPlanBatchHandoff', () => {
    it('maps plan batch row to handoff shape', () => {
        expect(toPlanBatchHandoff(baseBatch())).toEqual({
            planBatchId: 'pb-1',
            planId: 'plan-1',
            beanId: 'bean-1',
            blendId: null,
            beanName: 'Ethiopia',
            batchSizeKg: 12,
            profileId: 'prof-1',
            batchCount: 3,
            completedSessions: 1,
        });
    });
});

describe('resolveEffectiveBatch', () => {
    it('prefers session handoff over linked batch', () => {
        const handoff = toPlanBatchHandoff(baseBatch({ id: 'handoff' }));
        const linked = toPlanBatchHandoff(baseBatch({ id: 'linked' }));
        expect(resolveEffectiveBatch(handoff, linked)?.planBatchId).toBe('handoff');
    });

    it('falls back to linked batch when no handoff', () => {
        const linked = toPlanBatchHandoff(baseBatch({ id: 'linked' }));
        expect(resolveEffectiveBatch(null, linked)?.planBatchId).toBe('linked');
    });

    it('returns null when neither present', () => {
        expect(resolveEffectiveBatch(null, null)).toBeNull();
    });
});
