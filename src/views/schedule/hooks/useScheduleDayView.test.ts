import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type CompleteBatchFlowDeps, runCompleteBatchFlow } from './useScheduleDayView';

const baseBatch = (over: Partial<PlanBatchWithProgress> = {}): PlanBatchWithProgress =>
    ({
        id: 'pb-1',
        plan_id: 'plan-1',
        bean_id: 'bean-1',
        blend_id: null,
        bean_name: 'Ethiopia',
        batch_size_kg: 5,
        batch_count: 2,
        completed_sessions: 1,
        recurrence_rule_id: null,
        ...over,
    }) as PlanBatchWithProgress;

function makeDeps(overrides: Partial<CompleteBatchFlowDeps> = {}): CompleteBatchFlowDeps {
    return {
        ensureMaterialized: vi.fn().mockResolvedValue({ targetId: 'pb-1', targetPlanId: 'plan-1' }),
        commitStatus: vi.fn().mockResolvedValue(undefined),
        deduct: vi.fn().mockResolvedValue(undefined),
        notify: vi.fn(),
        ...overrides,
    };
}

describe('runCompleteBatchFlow', () => {
    beforeEach(() => vi.clearAllMocks());

    it('해피패스: materialize → deduct(referenceId=targetId) → done 커밋 순서', async () => {
        const deps = makeDeps({
            ensureMaterialized: vi.fn().mockResolvedValue({ targetId: 'real-1', targetPlanId: 'plan-9' }),
        });
        await runCompleteBatchFlow(deps, baseBatch(), true);

        expect(deps.ensureMaterialized).toHaveBeenCalledTimes(1);
        expect(deps.deduct).toHaveBeenCalledWith({
            deductionGrams: 5000, // 1 remaining session x 5kg
            singleBeanId: 'bean-1',
            blendId: null,
            referenceId: 'real-1',
        });
        expect(deps.commitStatus).toHaveBeenCalledWith(
            expect.anything(),
            { targetId: 'real-1', targetPlanId: 'plan-9' },
            'done',
        );
        // deduct must run before the done commit
        const deductOrder = (deps.deduct as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
        const commitOrder = (deps.commitStatus as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
        expect(deductOrder).toBeLessThan(commitOrder);
    });

    it('deduct 실패 → 에러 전파 + done 커밋 안 함 (재시도 가능)', async () => {
        const deps = makeDeps({
            deduct: vi.fn().mockRejectedValue(new Error('Workspace is still loading')),
        });
        await expect(runCompleteBatchFlow(deps, baseBatch(), true)).rejects.toThrow('Workspace is still loading');
        expect(deps.commitStatus).not.toHaveBeenCalled();
    });

    it('roast_already_deducted → 알림 후 done 커밋은 진행 (세션 경로가 이미 차감)', async () => {
        const deps = makeDeps({
            deduct: vi.fn().mockRejectedValue(new Error('roast_already_deducted')),
        });
        await runCompleteBatchFlow(deps, baseBatch(), true);
        expect(deps.notify).toHaveBeenCalledWith('activeRoast.summary.deductSkippedAlreadyDeducted');
        expect(deps.commitStatus).toHaveBeenCalledTimes(1);
    });

    it('deductStock=false → 차감 없이 done 커밋', async () => {
        const deps = makeDeps();
        await runCompleteBatchFlow(deps, baseBatch(), false);
        expect(deps.deduct).not.toHaveBeenCalled();
        expect(deps.commitStatus).toHaveBeenCalledTimes(1);
    });

    it('bean/blend 없음 → 알림, 차감 없이 done 커밋', async () => {
        const deps = makeDeps();
        await runCompleteBatchFlow(deps, baseBatch({ bean_id: null, blend_id: null }), true);
        expect(deps.notify).toHaveBeenCalledWith('schedule.completeBatch.deductStockDisabled');
        expect(deps.deduct).not.toHaveBeenCalled();
        expect(deps.commitStatus).toHaveBeenCalledTimes(1);
    });
});
