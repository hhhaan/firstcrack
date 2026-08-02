import { BatchLimitError } from '@shared/lib/features';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SaveRoastDeps, saveRoastCore } from './useSaveRoast';

const baseParams = {
    formData: {
        notes: '',
        weightGrams: 5,
        outputWeightKg: 4.2,
        roastLevel: 'city',
        beanId: 'bean-1',
        deductStock: true,
    },
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
        saveOp: vi.fn().mockResolvedValue({ id: 'sess-db-1' }),
        syncRoastCurve: vi.fn().mockResolvedValue(undefined),
        updatePlanBatch: vi.fn().mockResolvedValue(undefined),
        startBatch: vi.fn(),
        recordAdhocSave: vi.fn(),
        getFinalizedBbp: () => null,
        ...overrides,
    } as SaveRoastDeps;
}

describe('saveRoastCore', () => {
    beforeEach(() => vi.clearAllMocks());

    it('월 배치 캡 도달 → BatchLimitError, saveOp 없음', async () => {
        const deps = makeDeps({
            countCompletedThisMonth: vi.fn().mockResolvedValue(9999),
        });
        await expect(saveRoastCore(deps, baseParams)).rejects.toBeInstanceOf(BatchLimitError);
        expect(deps.saveOp).not.toHaveBeenCalled();
    });

    it('trial 20회 도달 → trial_batch_cap, saveOp 없음', async () => {
        const deps = makeDeps({
            plan: 'trial',
            countCompletedTotal: vi.fn().mockResolvedValue(20),
        });
        await expect(saveRoastCore(deps, baseParams)).rejects.toMatchObject({ code: 'trial_batch_cap' });
        expect(deps.saveOp).not.toHaveBeenCalled();
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

    it('월 카운트 API 실패 → fail-open, 저장 성공 (서버 게이트 위임)', async () => {
        const deps = makeDeps({
            countCompletedThisMonth: vi.fn().mockRejectedValue(new Error('network down')),
        });
        const result = await saveRoastCore(deps, baseParams);
        expect(result.savedSession).toEqual({ id: 'sess-db-1' });
        expect(deps.saveOp).toHaveBeenCalledTimes(1);
    });

    it('trial 카운트 API 실패 → fail-open, 저장 성공', async () => {
        const deps = makeDeps({
            plan: 'trial',
            countCompletedTotal: vi.fn().mockRejectedValue(new Error('network down')),
        });
        const result = await saveRoastCore(deps, baseParams);
        expect(result.savedSession).toEqual({ id: 'sess-db-1' });
        expect(deps.saveOp).toHaveBeenCalledTimes(1);
    });

    it('read_only → 즉시 거부', async () => {
        const deps = makeDeps({ plan: 'read_only' });
        await expect(saveRoastCore(deps, baseParams)).rejects.toMatchObject({ code: 'read_only_plan' });
        expect(deps.saveOp).not.toHaveBeenCalled();
    });

    it('서버 게이트 RAISE → BatchLimitError로 매핑', async () => {
        const deps = makeDeps({
            saveOp: vi.fn().mockRejectedValue(new Error('trial_expired')),
        });
        await expect(saveRoastCore(deps, baseParams)).rejects.toMatchObject({ code: 'trial_expired' });
    });

    it('해피패스: save_roast_op 단일 호출 + plan_batch_id + 마지막 배치 → done', async () => {
        const deps = makeDeps({ planBatchHandoff: handoff });
        const result = await saveRoastCore(deps, { ...baseParams, planBatchHandoff: handoff });

        expect(deps.saveOp).toHaveBeenCalledTimes(1);
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.plan_batch_id).toBe('batch-1');
        expect(arg.session.weight_grams).toBe(5000);
        expect(arg.session.output_weight_grams).toBe(4200);
        expect(arg.deduct).toBe(true);
        expect(arg.deductionGrams).toBe(5000);
        expect(arg.inboundGrams).toBe(4200);
        expect(arg.inboundIsEstimate).toBe(false);
        const times = (arg.session.events as Array<{ time_sec: number }>).map((e) => e.time_sec);
        expect(times).toEqual([...times].sort((a, b) => a - b));

        expect(deps.updatePlanBatch).toHaveBeenCalledTimes(1);
        expect(deps.updatePlanBatch).toHaveBeenCalledWith({
            id: 'batch-1',
            patch: { id: 'batch-1', status: 'done' },
        });
        expect(result.shouldOpenContinue).toBe(true);
    });

    it('마지막 배치 status 업데이트 실패 → 저장 성공 유지 + batchStatusUpdateFailed', async () => {
        const deps = makeDeps({
            planBatchHandoff: handoff,
            updatePlanBatch: vi.fn().mockRejectedValue(new Error('network down')),
        });
        const result = await saveRoastCore(deps, { ...baseParams, planBatchHandoff: handoff });
        expect(result.savedSession).toEqual({ id: 'sess-db-1' });
        expect(result.batchStatusUpdateFailed).toBe(true);
    });

    it('status 업데이트 성공 → batchStatusUpdateFailed false', async () => {
        const deps = makeDeps({ planBatchHandoff: handoff });
        const result = await saveRoastCore(deps, { ...baseParams, planBatchHandoff: handoff });
        expect(result.batchStatusUpdateFailed).toBe(false);
    });

    it('멱등키: 로컬 sessionId를 session.id로 전달', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, baseParams);
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.id).toBe('local-sess');
    });

    it('sessionId 없음 → session.id undefined (서버 발급 폴백)', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, { ...baseParams, sessionId: null });
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.id).toBeUndefined();
    });

    it('deductStock false → deduct 플래그 false', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, {
            ...baseParams,
            formData: { ...baseParams.formData, deductStock: false },
        });
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.deduct).toBe(false);
        expect(arg.deductionGrams).toBe(0);
    });

    it('차감 중량 > 0 + 생두 없음 + 라벨 없음 → 거부', async () => {
        const deps = makeDeps();
        await expect(
            saveRoastCore(deps, {
                ...baseParams,
                formData: { ...baseParams.formData, beanId: null, beanLabel: null, weightGrams: 5 },
                selectedBeanId: null,
            }),
        ).rejects.toThrow(/green bean/i);
        expect(deps.saveOp).not.toHaveBeenCalled();
    });

    it('차감 중량 0 + 생두 없음 → 저장 허용, bean_id null', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, {
            ...baseParams,
            formData: {
                ...baseParams.formData,
                beanId: null,
                weightGrams: 0,
                outputWeightKg: undefined,
                deductStock: false,
            },
            selectedBeanId: null,
        });
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.bean_id).toBeNull();
        expect(arg.session.weight_grams).toBe(0);
        expect(arg.deduct).toBe(false);
    });

    it('free-text bean_label → 저장, stock 미반영', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, {
            ...baseParams,
            formData: {
                ...baseParams.formData,
                beanId: null,
                beanLabel: '  Sample Lot A  ',
                weightGrams: 0.5,
                outputWeightKg: 0.4,
                deductStock: true,
            },
            selectedBeanId: null,
        });
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.bean_id).toBeNull();
        expect(arg.session.bean_label).toBe('Sample Lot A');
        expect(arg.session.weight_grams).toBe(500);
        expect(arg.deduct).toBe(false);
        expect(arg.deductionGrams).toBe(0);
        expect(arg.inboundGrams).toBe(0);
    });

    it('free-text 입력 시 header selectedBeanId를 덮어쓰지 않음', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, {
            ...baseParams,
            formData: {
                ...baseParams.formData,
                beanId: null,
                beanLabel: 'Sample Only',
                weightGrams: 0.3,
                deductStock: true,
            },
            selectedBeanId: 'header-bean-id',
        });
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.bean_id).toBeNull();
        expect(arg.session.bean_label).toBe('Sample Only');
        expect(arg.deduct).toBe(false);
        expect(arg.inboundGrams).toBe(0);
    });

    it('inventory bean 있으면 bean_label 무시', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, {
            ...baseParams,
            formData: {
                ...baseParams.formData,
                beanId: 'bean-1',
                beanLabel: 'should-not-save',
                deductStock: false,
            },
        });
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.bean_id).toBe('bean-1');
        expect(arg.session.bean_label).toBeNull();
    });
});
