// @vitest-environment jsdom
import { planBatchApi } from '@entities/plan';
import { invalidateRoastSessionQueries } from '@entities/roast';
import { BatchLimitError, resolveEffectivePlan, useEffectivePlan } from '@shared/lib/features';
import { useAuthStore } from '@shared/store/auth';
import type { PlanBatchHandoff, RoastSession } from '@shared/types/database.types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBbpStore } from './bbp';
import { useRoastingStore } from './status';
import { refreshCachesAfterRoastSave, type SaveRoastDeps, saveRoastCore, useSaveRoast } from './useSaveRoast';

const hookMocks = vi.hoisted(() => ({
    useEffectivePlan: vi.fn(() => 'pro'),
    saveOp: vi.fn().mockResolvedValue({ id: 'sess-db-1' }),
    flushTsv: vi.fn().mockResolvedValue(undefined),
    useActiveWorkspace: vi.fn(() => ({ workspaceOwnerId: 'B', isWorkspaceReady: true })),
}));

vi.mock('@shared/lib/features', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/features')>();
    return { ...actual, useEffectivePlan: hookMocks.useEffectivePlan };
});

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => hookMocks.useActiveWorkspace(),
}));

vi.mock('@entities/roast', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@entities/roast')>();
    return {
        ...actual,
        roastSessionApi: {
            ...actual.roastSessionApi,
            countCompletedThisMonth: vi.fn().mockResolvedValue(0),
            countCompletedTotal: vi.fn().mockResolvedValue(0),
            saveOp: (...args: unknown[]) => hookMocks.saveOp(...args),
            invalidateRoastSessionQueries: vi.fn().mockResolvedValue(undefined),
        },
        invalidateRoastSessionQueries: vi.fn().mockResolvedValue(undefined),
    };
});

vi.mock('@shared/lib/tsv-writer', () => ({
    TSV_HEADER: 'time\tbt\n',
    flushTsv: (...args: unknown[]) => hookMocks.flushTsv(...args),
}));

const baseParams: Parameters<typeof saveRoastCore>[1] = {
    formData: {
        notes: '',
        weightGrams: 5,
        outputWeightKg: 4.2,
        roastLevel: 'city',
        beanId: 'bean-1',
        deductStock: true,
    },
    handoffBeanName: null,
    sessionId: '11111111-1111-4111-8111-111111111111',
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
};

const handoff: PlanBatchHandoff = {
    planBatchId: '22222222-2222-4222-8222-222222222222',
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
        qc: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
        countCompletedThisMonth: vi.fn().mockResolvedValue(0),
        countCompletedTotal: vi.fn().mockResolvedValue(0),
        saveOp: vi.fn().mockResolvedValue({ id: 'sess-db-1' }),
        flushCurve: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
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

    it('로컬 커브 flush 실패 시 메타데이터를 저장하지 않는다', async () => {
        const flushCurve = vi.fn().mockRejectedValue(new Error('TSV initialization failed'));
        const deps = makeDeps({ flushCurve });

        await expect(saveRoastCore(deps, baseParams)).rejects.toThrow('TSV initialization failed');
        expect(flushCurve).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
        expect(deps.saveOp).not.toHaveBeenCalled();
    });

    it('empty personal plan on self workspace does not block save', async () => {
        const plan = resolveEffectivePlan({
            personalPlan: '',
            authUserId: 'user-1',
            activeOwnerId: null,
            ownerPlanById: {},
        });
        const deps = makeDeps({ plan });
        const result = await saveRoastCore(deps, baseParams);
        expect(result.savedSession).toEqual({ id: 'sess-db-1' });
        expect(deps.saveOp).toHaveBeenCalledTimes(1);
    });

    it('foreign workspace missing host plan still blocks save', async () => {
        const plan = resolveEffectivePlan({
            personalPlan: 'pro',
            authUserId: 'user-1',
            activeOwnerId: 'owner-1',
            ownerPlanById: { 'owner-1': '' },
        });
        const deps = makeDeps({ plan });
        await expect(saveRoastCore(deps, baseParams)).rejects.toMatchObject({ code: 'read_only_plan' });
        expect(deps.saveOp).not.toHaveBeenCalled();
    });

    it('서버 게이트 RAISE → BatchLimitError로 매핑', async () => {
        const deps = makeDeps({
            saveOp: vi.fn().mockRejectedValue(new Error('trial_expired')),
        });
        await expect(saveRoastCore(deps, baseParams)).rejects.toMatchObject({ code: 'trial_expired' });
    });

    it('saves the normalized batch and stock payload without mutating live progress', async () => {
        const deps = makeDeps();
        const liveBefore = useRoastingStore.getState();
        const result = await saveRoastCore(deps, { ...baseParams, planBatchHandoff: handoff });

        expect(deps.saveOp).toHaveBeenCalledTimes(1);
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.plan_batch_id).toBe('22222222-2222-4222-8222-222222222222');
        expect(arg.session.weight_grams).toBe(5000);
        expect(arg.session.output_weight_grams).toBe(4200);
        expect(arg.deduct).toBe(true);
        expect(arg.deductionGrams).toBe(5000);
        expect(arg.inboundGrams).toBe(4200);
        expect(arg.inboundIsEstimate).toBe(false);
        const times = (arg.session.events as Array<{ time_sec: number }>).map((e) => e.time_sec);
        expect(times).toEqual([...times].sort((a, b) => a - b));

        expect(useRoastingStore.getState()).toBe(liveBefore);
        expect(result.shouldOpenContinue).toBe(true);
    });

    it('uses the submitted owner and manual link as the save authority', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, {
            ...baseParams,
            userId: 'snapshot-owner',
            formData: { ...baseParams.formData, linkedBatch: handoff },
        });
        expect(deps.countCompletedThisMonth).toHaveBeenCalledWith('snapshot-owner');
        expect(deps.saveOp).toHaveBeenCalledWith(
            expect.objectContaining({
                session: expect.objectContaining({ user_id: 'snapshot-owner', plan_batch_id: handoff.planBatchId }),
            }),
        );
    });

    it.each(['', 'rule:2026-09-17', '__optimistic__batch'])(
        'rejects unprepared linked batch ID %s before flushing or saving',
        async (planBatchId) => {
            const deps = makeDeps();
            await expect(
                saveRoastCore(deps, { ...baseParams, planBatchHandoff: { ...handoff, planBatchId } }),
            ).rejects.toMatchObject({ code: '22P02' });
            expect(deps.flushCurve).not.toHaveBeenCalled();
            expect(deps.saveOp).not.toHaveBeenCalled();
        },
    );

    it.each([true, false])(
        'uses the frozen BBP only when it belongs to the submitted session (%s)',
        async (sameSession) => {
            const deps = makeDeps();
            const liveBbp = { sessionId: 'another-live-session', seconds: 999, chargeTemp: 999 };
            useBbpStore.setState({ finalized: liveBbp });
            await saveRoastCore(deps, {
                ...baseParams,
                bbpSummary: {
                    sessionId: sameSession ? '11111111-1111-4111-8111-111111111111' : 'other-session',
                    seconds: 120,
                    chargeTemp: 201.6,
                },
            });
            expect(deps.saveOp).toHaveBeenCalledWith(
                expect.objectContaining({
                    session: expect.objectContaining({
                        bbp_seconds: sameSession ? 120 : null,
                        charge_temp_celsius: sameSession ? 202 : null,
                    }),
                }),
            );
            expect(useBbpStore.getState().finalized).toBe(liveBbp);
        },
    );

    it('멱등키: 로컬 sessionId를 session.id로 전달', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, baseParams);
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.id).toBe('11111111-1111-4111-8111-111111111111');
    });

    it('drop_temp: Drop 로그 tempC 우선 (라이브 rawBT 무시) (#173)', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, {
            ...baseParams,
            rawBT: 160,
            logEntries: [
                { id: '1', time: '0:00', timeSec: 0, event: 'Charge', temp: '', tempC: 180, note: '' },
                { id: '2', time: '10:00', timeSec: 600, event: 'Drop', temp: '', tempC: 205.4, note: '' },
                { id: '3', time: '10:05', timeSec: 605, event: 'End', temp: '', tempC: 204, note: '' },
            ],
        });
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.drop_temp_celsius).toBe(205);
    });

    it('drop_temp: Drop 없으면 End tempC (#173)', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, {
            ...baseParams,
            rawBT: 160,
            logEntries: [
                { id: '1', time: '0:00', timeSec: 0, event: 'Charge', temp: '', tempC: 180, note: '' },
                { id: '2', time: '10:05', timeSec: 605, event: 'End', temp: '', tempC: 210.2, note: '' },
            ],
        });
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.drop_temp_celsius).toBe(210);
    });

    it('drop_temp: 로그 온도 없으면 rawBT fallback (#173)', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, {
            ...baseParams,
            rawBT: 199.6,
            logEntries: [{ id: '1', time: '0:00', timeSec: 0, event: 'Charge', temp: '', note: '' }],
        });
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.drop_temp_celsius).toBe(200);
    });

    it.each([null, '', 'legacy-session'])(
        'rejects an unprepared session ID %s instead of generating another session',
        async (sessionId) => {
            const deps = makeDeps();
            await expect(saveRoastCore(deps, { ...baseParams, sessionId })).rejects.toMatchObject({ code: '22P02' });
            expect(deps.saveOp).not.toHaveBeenCalled();
            expect(deps.flushCurve).not.toHaveBeenCalled();
        },
    );

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

    it('연결된 머신 스냅샷을 세션에 저장한다', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, {
            ...baseParams,
            machineSnapshot: {
                machine_id: 'm1',
                machine_name: 'Shop Giesen',
                machine_roaster_key: 'giesen_w6a',
                machine_brand: 'Giesen',
                machine_protocol: 's7',
            },
        });
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.machine_id).toBe('m1');
        expect(arg.session.machine_name).toBe('Shop Giesen');
        expect(arg.session.machine_roaster_key).toBe('giesen_w6a');
        expect(arg.session.machine_brand).toBe('Giesen');
        expect(arg.session.machine_protocol).toBe('s7');
    });

    it('스냅샷 없으면 머신 필드는 null', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, baseParams);
        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.session.machine_id).toBeNull();
        expect(arg.session.machine_name).toBeNull();
        expect(arg.session.machine_roaster_key).toBeNull();
        expect(arg.session.machine_brand).toBeNull();
        expect(arg.session.machine_protocol).toBeNull();
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

    it('does not await history/dashboard refetch (coordinator refreshes once after save)', async () => {
        const deps = makeDeps();
        await saveRoastCore(deps, baseParams);
        expect(invalidateRoastSessionQueries).not.toHaveBeenCalled();
    });
});

describe('refreshCachesAfterRoastSave', () => {
    beforeEach(() => vi.clearAllMocks());

    const keysOf = (qc: QueryClient) => {
        const seen: string[] = [];
        vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters) => {
            const key = (filters as { queryKey?: readonly unknown[] } | undefined)?.queryKey?.[0];
            seen.push(String(key));
            return Promise.resolve();
        });
        return seen;
    };

    it('invalidates schedule caches only after the progress update', async () => {
        let release: () => void = () => {};
        const sync = vi.spyOn(planBatchApi, 'syncRoastProgress').mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = () => resolve({} as never);
                }),
        );
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const seen = keysOf(qc);
        const pending = refreshCachesAfterRoastSave(qc, {
            id: 'sess',
            user_id: 'owner',
            plan_batch_id: 'batch-1',
        } as RoastSession);
        expect(seen).toContain('roast_sessions');
        expect(seen).not.toContain('day_batches');
        expect(seen).not.toContain('dashboard');
        release();
        await pending;
        expect(sync).toHaveBeenCalledExactlyOnceWith('owner', 'batch-1');
        expect(seen).toContain('day_batches');
        expect(seen).toContain('dashboard');
        sync.mockRestore();
    });

    it('a rejected schedule update does not invalidate schedule or dashboard caches', async () => {
        const sync = vi.spyOn(planBatchApi, 'syncRoastProgress').mockRejectedValue(new Error('schedule'));
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const seen = keysOf(qc);
        await expect(
            refreshCachesAfterRoastSave(qc, {
                id: 'sess',
                user_id: 'owner',
                plan_batch_id: 'batch-1',
            } as RoastSession),
        ).rejects.toThrow('schedule');
        expect(seen).toContain('roast_sessions');
        expect(seen).not.toContain('day_batches');
        expect(seen).not.toContain('dashboard');
        sync.mockRestore();
    });

    it('still refreshes history and dashboard when the roast is unlinked', async () => {
        const sync = vi.spyOn(planBatchApi, 'syncRoastProgress').mockResolvedValue({} as never);
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const seen = keysOf(qc);
        await refreshCachesAfterRoastSave(qc, {
            id: 'sess',
            user_id: 'owner',
            plan_batch_id: null,
        } as RoastSession);
        expect(sync).not.toHaveBeenCalled();
        expect(seen).toContain('roast_sessions');
        expect(seen).toContain('dashboard');
        expect(seen).not.toContain('day_batches');
        sync.mockRestore();
    });

    it('shows a bare RPC row before history refetch finishes', async () => {
        const { roastSessionKeys } = await import('@entities/roast');
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        const page = roastSessionKeys.paginated('owner', 'completed', 1, 10, 'date', false, null, null, null);
        qc.setQueryData(page, { data: [], total: 0 });
        let release: () => void = () => {};
        vi.spyOn(qc, 'invalidateQueries').mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        vi.spyOn(planBatchApi, 'syncRoastProgress').mockResolvedValue({} as never);
        const pending = refreshCachesAfterRoastSave(qc, {
            id: 'rpc',
            user_id: 'owner',
            status: 'completed',
            roasted_at: '2026-09-22T00:00:00.000Z',
            plan_batch_id: null,
        } as RoastSession);
        expect(qc.getQueryData<{ data: { id: string; beans: null }[] }>(page)?.data).toEqual([
            expect.objectContaining({ id: 'rpc', beans: null, roast_profiles: null }),
        ]);
        release();
        await pending;
    });
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useSaveRoast workspace owner boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hookMocks.useEffectivePlan.mockReturnValue('pro');
        hookMocks.saveOp.mockResolvedValue({ id: 'sess-db-1' });
        hookMocks.useActiveWorkspace.mockReturnValue({ workspaceOwnerId: 'B', isWorkspaceReady: true });
        useRoastingStore.setState({ sessionOwnerId: 'A' });
        useAuthStore.setState({ user: { id: 'auth-1' } as never });
    });

    it('keeps the explicit workspace owner when the live session belongs elsewhere', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const host = document.createElement('div');
        const root = createRoot(host);
        let api: ReturnType<typeof useSaveRoast> | undefined;
        const Probe = () => {
            api = useSaveRoast(null, vi.fn().mockResolvedValue(undefined));
            return null;
        };
        act(() => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe))));

        expect(useEffectivePlan).toHaveBeenCalledWith(undefined, 'B');
        if (!api) throw new Error('Hook did not render');
        const saveApi = api;
        expect(saveApi.resumeSave).toBeTypeOf('function');

        await act(async () => {
            await saveApi.saveRoast({
                formData: {
                    notes: '',
                    weightGrams: 5,
                    outputWeightKg: 4.2,
                    roastLevel: 'city',
                    beanId: 'bean-1',
                    deductStock: false,
                },
                handoffBeanName: null,
                sessionId: '11111111-1111-4111-8111-111111111111',
                userId: 'B',
                elapsed: 600,
                roastStartTimeRef: { current: 1750000000000 },
                rawBT: 205.4,
                selectedBeanId: 'bean-1',
                targetProfileId: null,
                planBatchHandoff: null,
                logEntries: [],
            });
        });

        expect(hookMocks.saveOp).toHaveBeenCalledTimes(1);
        expect(hookMocks.saveOp.mock.calls[0][0].session.user_id).toBe('B');
        expect(useRoastingStore.getState().sessionOwnerId).toBe('A');
        await expect(saveApi.saveRoast({ ...baseParams, userId: 'A' })).rejects.toThrow();
        expect(hookMocks.saveOp).toHaveBeenCalledTimes(1);
        act(() => root.unmount());
    });
});
