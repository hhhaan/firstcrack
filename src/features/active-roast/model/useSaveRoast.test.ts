import { BatchLimitError } from '@shared/lib/features';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SaveRoastDeps, saveRoastCore } from './useSaveRoast';

const baseParams = {
    formData: { notes: '', weightGrams: 5, outputWeightKg: 4.2, roastLevel: 'city', beanId: 'bean-1' },
    handoffBeanName: null,
    sessionId: 'local-sess',
    userId: 'user-1',
    elapsed: 600,
    roastStartTimeRef: { current: 1750000000000 },
    rawBT: 205.4,
    selectedBeanId: 'bean-1',
    targetProfileId: null,
    planBatchHandoff: null,
    logEntries: [
        { id: '2', time: '5:00', timeSec: 300, event: 'First Crack', temp: '', note: '' },
        { id: '1', time: '0:00', timeSec: 0, event: 'Charge', temp: '', note: '' },
        { id: '3', time: '10:00', timeSec: 600, event: 'Drop', temp: '', note: '' },
    ],
} as unknown as Parameters<typeof saveRoastCore>[1];

const handoff: PlanBatchHandoff = {
    planBatchId: 'batch-1',
    planId: 'plan-1',
    beanId: 'bean-1',
    blendId: null,
    beanName: 'Yirg',
    batchCount: 2,
    completedSessions: 1,
    batchSizeKg: 5,
    profileId: null,
};

function makeDeps(overrides: Partial<SaveRoastDeps> = {}): SaveRoastDeps {
    return {
        plan: 'pro',
        userId: 'user-1',
        qc: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
        planBatchHandoff: null,
        countCompletedThisMonth: vi.fn().mockResolvedValue(0),
        countCompletedTotal: vi.fn().mockResolvedValue(0),
        createSession: vi.fn().mockResolvedValue({ id: 'sess-db-1' }),
        syncRoastCurve: vi.fn().mockResolvedValue(undefined),
        upsertInbound: vi.fn().mockResolvedValue(undefined),
        updatePlanBatch: vi.fn().mockResolvedValue(undefined),
        startBatch: vi.fn(),
        recordAdhocSave: vi.fn(),
        getFinalizedBbp: () => null,
        ...overrides,
    } as SaveRoastDeps;
}

describe('saveRoastCore', () => {
    beforeEach(() => vi.clearAllMocks());

    it('월 배치 캡 도달 → BatchLimitError, 세션 생성/차감 없음', async () => {
        const deps = makeDeps({
            countCompletedThisMonth: vi.fn().mockResolvedValue(9999), // pro 캡 이상
        });
        await expect(saveRoastCore(deps, baseParams)).rejects.toBeInstanceOf(BatchLimitError);
        expect(deps.createSession).not.toHaveBeenCalled();
        expect(deps.upsertInbound).not.toHaveBeenCalled();
    });

    it('trial 20회 도달 → trial_batch_cap, 세션 생성 없음', async () => {
        const deps = makeDeps({
            plan: 'trial',
            countCompletedTotal: vi.fn().mockResolvedValue(20),
        });
        await expect(saveRoastCore(deps, baseParams)).rejects.toMatchObject({ code: 'trial_batch_cap' });
        expect(deps.createSession).not.toHaveBeenCalled();
    });

    it('trial 19회 → 저장 통과 (월 캡 미적용)', async () => {
        const deps = makeDeps({
            plan: 'trial',
            countCompletedTotal: vi.fn().mockResolvedValue(19),
            countCompletedThisMonth: vi.fn().mockResolvedValue(9999),
        });
        const result = await saveRoastCore(deps, baseParams);
        expect(result.savedSession).toEqual({ id: 'sess-db-1' });
    });

    it('read_only → 즉시 거부', async () => {
        const deps = makeDeps({ plan: 'read_only' });
        await expect(saveRoastCore(deps, baseParams)).rejects.toMatchObject({ code: 'read_only_plan' });
        expect(deps.createSession).not.toHaveBeenCalled();
    });

    it('서버 게이트 RAISE → BatchLimitError로 매핑', async () => {
        const deps = makeDeps({
            createSession: vi.fn().mockRejectedValue(new Error('trial_expired')),
        });
        await expect(saveRoastCore(deps, baseParams)).rejects.toMatchObject({ code: 'trial_expired' });
    });

    it('해피패스: 이벤트 시간순 직렬화 + plan_batch_id + 마지막 배치 → done', async () => {
        const deps = makeDeps({ planBatchHandoff: handoff });
        const result = await saveRoastCore(deps, { ...baseParams, planBatchHandoff: handoff });

        const payload = (deps.createSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(payload.plan_batch_id).toBe('batch-1');
        expect(payload.weight_grams).toBe(5000);
        expect(payload.output_weight_grams).toBe(4200);
        const times = (payload.events as Array<{ time_sec: number }>).map((e) => e.time_sec);
        expect(times).toEqual([...times].sort((a, b) => a - b)); // 시간순

        // completedSessions 1 + 1 == batchCount 2 → done 1회
        expect(deps.updatePlanBatch).toHaveBeenCalledTimes(1);
        expect(deps.updatePlanBatch).toHaveBeenCalledWith({
            id: 'batch-1',
            patch: { id: 'batch-1', status: 'done' },
        });
        expect(result.shouldOpenContinue).toBe(true);
    });

    it('roasted inbound 실패해도 저장 플로우는 성공', async () => {
        const deps = makeDeps({ upsertInbound: vi.fn().mockRejectedValue(new Error('rls')) });
        const result = await saveRoastCore(deps, baseParams);
        expect(result.savedSession).toEqual({ id: 'sess-db-1' });
    });
});
