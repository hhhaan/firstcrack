import type { PlanBatch, PlanBatchWithProgress } from '@shared/types/database.types';
import { describe, expect, it, vi } from 'vitest';
import { isVirtualPlanBatchId, resolveLinkedScheduleBatch } from './resolveLinkedScheduleBatch';

const virtualRow = (over: Partial<PlanBatchWithProgress> = {}): PlanBatchWithProgress =>
    ({
        id: 'rule-1:2026-09-01',
        plan_id: '',
        bean_id: 'bean-1',
        blend_id: null,
        bean_name: 'Kenya',
        batch_size_kg: 5,
        target_roasted_kg: 4,
        roast_profile_id: null,
        batch_count: 1,
        completed_sessions: 0,
        recurrence_rule_id: 'rule-1',
        scheduled_date: '2026-09-01',
        original_date: '2026-09-01',
        machine_id: null,
        notes: null,
        green_lot: null,
        batch_type: 'Single Origin',
        yield_pct: 0.82,
        status: 'pending',
        ...over,
    }) as PlanBatchWithProgress;

describe('isVirtualPlanBatchId', () => {
    it('detects ruleId:date virtual ids', () => {
        expect(isVirtualPlanBatchId('rule-1:2026-09-01')).toBe(true);
        expect(isVirtualPlanBatchId('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(false);
    });
});

describe('resolveLinkedScheduleBatch', () => {
    it('materializes virtual recurring rows before returning a uuid handoff', async () => {
        const materialize = vi.fn(async () => ({ id: 'real-uuid', plan_id: 'plan-9' }) as PlanBatch);
        const handoff = await resolveLinkedScheduleBatch(virtualRow(), 'user-1', materialize);

        expect(materialize).toHaveBeenCalledWith(
            'user-1',
            'rule-1',
            '2026-09-01',
            '2026-09-01',
            expect.objectContaining({ bean_name: 'Kenya', batch_size_kg: 5 }),
        );
        expect(handoff.planBatchId).toBe('real-uuid');
        expect(handoff.planId).toBe('plan-9');
        expect(handoff.beanName).toBe('Kenya');
    });

    it('does not materialize a real uuid row', async () => {
        const materialize = vi.fn();
        const handoff = await resolveLinkedScheduleBatch(
            virtualRow({ id: 'real-uuid', plan_id: 'plan-1', recurrence_rule_id: null }),
            'user-1',
            materialize,
        );
        expect(materialize).not.toHaveBeenCalled();
        expect(handoff.planBatchId).toBe('real-uuid');
    });
});
