import type { PlanBatch, PlanBatchHandoff, PlanBatchWithProgress, RecurrenceRule } from '@shared/types/database.types';
import { describe, expect, it, vi } from 'vitest';
import { type ResolveForRoastDeps, resolveForRoast } from './resolve-for-roast';

const RULE = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const REAL = '11111111-1111-4111-8111-111111111111';
const PLAN = '22222222-2222-4222-8222-222222222222';
const OWNER = 'owner-1';

const virtualRow = (over: Partial<PlanBatchWithProgress> = {}): PlanBatchWithProgress =>
    ({
        id: `${RULE}:2026-09-01`,
        plan_id: '',
        bean_id: 'bean-1',
        blend_id: null,
        bean_name: 'Kenya',
        batch_size_kg: 5,
        target_roasted_kg: 4,
        roast_profile_id: null,
        batch_count: 2,
        completed_sessions: 0,
        recurrence_rule_id: RULE,
        scheduled_date: '2026-09-01',
        original_date: '2026-09-01',
        machine_id: null,
        notes: '',
        green_lot: '',
        batch_type: 'Single Origin',
        yield_pct: 0.82,
        status: 'pending',
        exception_type: null,
        ...over,
    }) as PlanBatchWithProgress;

const realBatch = (over: Partial<PlanBatch> = {}): PlanBatch =>
    ({
        id: REAL,
        plan_id: PLAN,
        bean_id: 'bean-1',
        blend_id: null,
        bean_name: 'Kenya',
        batch_size_kg: 5,
        target_roasted_kg: 4,
        roast_profile_id: null,
        batch_count: 2,
        recurrence_rule_id: RULE,
        scheduled_date: '2026-09-01',
        original_date: '2026-09-01',
        machine_id: null,
        notes: '',
        green_lot: '',
        batch_type: 'Single Origin',
        yield_pct: 0.82,
        status: 'pending',
        exception_type: 'modified',
        ...over,
    }) as PlanBatch;

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule =>
    ({
        id: RULE,
        user_id: OWNER,
        status: 'active',
        bean_name: 'Kenya',
        bean_id: 'bean-1',
        blend_id: null,
        batch_size_kg: 5,
        target_roasted_kg: 4,
        yield_pct: 0.82,
        roast_profile_id: null,
        machine_id: null,
        notes: '',
        green_lot: '',
        batch_type: 'Single Origin',
        ...over,
    }) as RecurrenceRule;

const handoff = (over: Partial<PlanBatchHandoff> = {}): PlanBatchHandoff => ({
    planBatchId: `${RULE}:2026-09-01`,
    planId: '',
    beanId: 'bean-1',
    blendId: null,
    beanName: 'Kenya',
    batchSizeKg: 5,
    profileId: null,
    batchCount: 2,
    completedSessions: 0,
    ...over,
});

function deps(over: Partial<ResolveForRoastDeps> = {}): ResolveForRoastDeps {
    return {
        materialize: vi.fn(async () => realBatch()),
        getRule: vi.fn(async () => rule()),
        getBatch: vi.fn(async () => realBatch()),
        getDayPlanOwner: vi.fn(async () => OWNER),
        countSessions: vi.fn(async () => 0),
        ...over,
    };
}

describe('resolveForRoast', () => {
    it('materializes a selected virtual row with conflict read and returns a real uuid', async () => {
        const d = deps();
        const latest = await resolveForRoast(OWNER, virtualRow(), d);

        expect(d.materialize).toHaveBeenCalledWith(
            OWNER,
            RULE,
            '2026-09-01',
            '2026-09-01',
            expect.objectContaining({ bean_name: 'Kenya', batch_size_kg: 5 }),
            { conflict: 'read' },
        );
        expect(latest.id).toBe(REAL);
        expect(latest.plan_id).toBe(PLAN);
        expect(latest.completed_sessions).toBe(0);
        expect(d.getDayPlanOwner).toHaveBeenCalledWith(PLAN);
    });

    it('materializes a virtual handoff from the rule snapshot', async () => {
        const d = deps();
        const latest = await resolveForRoast(OWNER, handoff(), d);

        expect(d.getRule).toHaveBeenCalledWith(RULE);
        expect(d.materialize).toHaveBeenCalledWith(
            OWNER,
            RULE,
            '2026-09-01',
            '2026-09-01',
            expect.objectContaining({ bean_name: 'Kenya' }),
            { conflict: 'read' },
        );
        expect(latest.id).toBe(REAL);
    });

    it('re-fetches a real uuid and verifies the day-plan owner', async () => {
        const d = deps();
        const latest = await resolveForRoast(OWNER, virtualRow({ id: REAL, plan_id: PLAN }), d);
        expect(d.materialize).not.toHaveBeenCalled();
        expect(d.getBatch).toHaveBeenCalledWith(REAL);
        expect(latest.id).toBe(REAL);
        expect(latest.completed_sessions).toBe(0);
    });

    it('rejects owner mismatch, cancelled batches, and non-canonical ids', async () => {
        await expect(
            resolveForRoast(
                OWNER,
                virtualRow({ id: REAL, plan_id: PLAN }),
                deps({ getDayPlanOwner: vi.fn(async () => 'other') }),
            ),
        ).rejects.toThrow(/owner/i);
        await expect(
            resolveForRoast(
                OWNER,
                virtualRow({ id: REAL, plan_id: PLAN }),
                deps({ getBatch: vi.fn(async () => realBatch({ exception_type: 'cancelled' })) }),
            ),
        ).rejects.toThrow(/cancel/i);
        const badId = deps();
        await expect(resolveForRoast(OWNER, virtualRow({ id: 'rule-1:2026-09-01' }), badId)).rejects.toThrow();
        expect(badId.materialize).not.toHaveBeenCalled();
    });

    it('does not materialize when the rule is cancelled or owned by someone else', async () => {
        const cancelled = deps({ getRule: vi.fn(async () => rule({ status: 'cancelled' })) });
        await expect(resolveForRoast(OWNER, virtualRow(), cancelled)).rejects.toThrow(/cancel/i);
        expect(cancelled.materialize).not.toHaveBeenCalled();

        const stolen = deps({ getRule: vi.fn(async () => rule({ user_id: 'other' })) });
        await expect(resolveForRoast(OWNER, virtualRow(), stolen)).rejects.toThrow(/owner/i);
        expect(stolen.materialize).not.toHaveBeenCalled();
    });
});
