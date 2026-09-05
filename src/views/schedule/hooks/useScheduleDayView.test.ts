import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildReorderIds,
    type CompleteBatchFlowDeps,
    isRoastBlockingScheduleStart,
    nextOneOffOrderIndex,
    runCompleteBatchFlow,
} from './useScheduleDayView';

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

describe('buildReorderIds', () => {
    const recurring = baseBatch({ id: 'rule-1:2026-08-03', recurrence_rule_id: 'rule-1', order_index: 0 });
    const oneOffA = baseBatch({ id: 'a', order_index: 1 });
    const oneOffB = baseBatch({ id: 'b', order_index: 2 });

    it('one-off끼리 스왑 → 가상 반복 id 제외, one-off id만 순서대로', () => {
        expect(buildReorderIds([recurring, oneOffA, oneOffB], 2, 'up')).toEqual(['b', 'a']);
    });

    it('반복 배치 위로 이동(스왑 상대가 반복) → null', () => {
        expect(buildReorderIds([recurring, oneOffA, oneOffB], 1, 'up')).toBeNull();
    });

    it('반복 배치 자체 이동 → null', () => {
        expect(buildReorderIds([recurring, oneOffA], 0, 'down')).toBeNull();
    });

    it('경계(첫 up / 마지막 down) → null', () => {
        expect(buildReorderIds([oneOffA, oneOffB], 0, 'up')).toBeNull();
        expect(buildReorderIds([oneOffA, oneOffB], 1, 'down')).toBeNull();
    });
});

describe('nextOneOffOrderIndex', () => {
    it('가상 반복 행은 세지 않고 max(one-off)+1', () => {
        const recurring = baseBatch({ id: 'rule-1:d', recurrence_rule_id: 'rule-1', order_index: 0 });
        const oneOff = baseBatch({ id: 'a', order_index: 5 });
        expect(nextOneOffOrderIndex([recurring, oneOff])).toBe(6);
    });

    it('one-off 없음 → 1 (0은 반복 고정 슬롯)', () => {
        const recurring = baseBatch({ id: 'rule-1:d', recurrence_rule_id: 'rule-1', order_index: 0 });
        expect(nextOneOffOrderIndex([recurring])).toBe(1);
        expect(nextOneOffOrderIndex([])).toBe(1);
    });
});

describe('isRoastBlockingScheduleStart', () => {
    it('머신 연결(preheating/standby)과 idle은 허용', () => {
        expect(isRoastBlockingScheduleStart('idle')).toBe(false);
        expect(isRoastBlockingScheduleStart('preheating')).toBe(false);
        expect(isRoastBlockingScheduleStart('standby')).toBe(false);
    });

    it('차지 중·미저장 종료만 차단', () => {
        expect(isRoastBlockingScheduleStart('roasting')).toBe(true);
        expect(isRoastBlockingScheduleStart('ended')).toBe(true);
    });
});
