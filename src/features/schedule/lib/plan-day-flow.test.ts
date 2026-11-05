import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildReorderIds,
    type CompleteBatchFlowDeps,
    nextOneOffOrderIndex,
    runCompleteBatchFlow,
} from './plan-day-flow';

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
        complete: vi.fn().mockResolvedValue(undefined),
        notify: vi.fn(),
        ...overrides,
    };
}

describe('runCompleteBatchFlow', () => {
    beforeEach(() => vi.clearAllMocks());

    it('materialize 뒤 서버 완료를 한 번 호출한다', async () => {
        const deps = makeDeps({
            ensureMaterialized: vi.fn().mockResolvedValue({ targetId: 'real-1', targetPlanId: 'plan-9' }),
        });
        await runCompleteBatchFlow(deps, baseBatch(), true);

        expect(deps.ensureMaterialized).toHaveBeenCalledTimes(1);
        expect(deps.complete).toHaveBeenCalledWith('real-1', true);
    });

    it('canonical row에 원두가 있으면 차감 플래그를 넘긴다', async () => {
        const latest = baseBatch({ bean_id: 'new-bean', completed_sessions: 0, batch_size_kg: 2 });
        const deps = makeDeps({
            ensureMaterialized: vi.fn().mockResolvedValue({ targetId: 'real', targetPlanId: 'plan', batch: latest }),
        });
        await runCompleteBatchFlow(deps, baseBatch(), true);
        expect(deps.complete).toHaveBeenCalledWith('real', true);
    });

    it('complete 실패는 그대로 전파한다', async () => {
        const deps = makeDeps({
            complete: vi.fn().mockRejectedValue(new Error('Workspace is still loading')),
        });
        await expect(runCompleteBatchFlow(deps, baseBatch(), true)).rejects.toThrow('Workspace is still loading');
    });

    it('deductStock=false → 차감 없이 완료', async () => {
        const deps = makeDeps();
        await runCompleteBatchFlow(deps, baseBatch(), false);
        expect(deps.complete).toHaveBeenCalledWith('pb-1', false);
    });

    it('bean/blend 없음 → 알림 후 차감 없이 완료', async () => {
        const deps = makeDeps();
        await runCompleteBatchFlow(deps, baseBatch({ bean_id: null, blend_id: null }), true);
        expect(deps.notify).toHaveBeenCalledWith('schedule.completeBatch.deductStockDisabled');
        expect(deps.complete).toHaveBeenCalledWith('pb-1', false);
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
