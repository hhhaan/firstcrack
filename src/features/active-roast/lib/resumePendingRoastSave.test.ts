// @vitest-environment jsdom
import { roastSessionKeys } from '@entities/roast';
import { logger } from '@shared/lib/logger';
import { dashboardKeys, inventoryQueryRoots, roastedStockKeys } from '@shared/lib/query-keys';
import type { PlanBatchHandoff, PlanBatchWithProgress, RoastSession } from '@shared/types/database.types';
import { QueryCache, QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPendingRoastSave, type PendingRoastParams, readPendingRoastSave } from '../model/pendingRoastSave';
import { refreshCachesAfterRoastSave } from '../model/useSaveRoast';
import { splitBatchBbp } from './batch-timeline';
import {
    isPendingRoastSaveActive,
    type ResumePendingRoastSaveDeps,
    resumePendingRoastSave,
} from './resumePendingRoastSave';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BATCH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const handoff: PlanBatchHandoff = {
    planBatchId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc:2026-09-01',
    planId: '',
    beanId: 'bean',
    blendId: null,
    beanName: 'Kenya',
    batchSizeKg: 5,
    profileId: null,
    batchCount: 2,
    completedSessions: 0,
};
const params: PendingRoastParams = {
    formData: { notes: '', weightGrams: 5, beanId: 'bean', roastLevel: null, deductStock: true },
    userId: 'owner',
    elapsed: 600,
    roastStartTime: 1234,
    rawBT: 205,
    selectedBeanId: 'bean',
    targetProfileId: null,
    planBatchHandoff: handoff,
    sessionId: ID,
    handoffBeanName: 'Kenya',
    logEntries: [],
};
const saved = { id: ID, user_id: 'owner', status: 'completed', plan_batch_id: BATCH } as RoastSession;
const row = {
    id: BATCH,
    plan_id: 'plan',
    bean_id: 'bean',
    blend_id: null,
    bean_name: 'Kenya',
    batch_size_kg: 5,
    roast_profile_id: null,
    batch_count: 2,
    completed_sessions: 0,
    status: 'in-progress',
} as PlanBatchWithProgress;
const deps = (patch: Partial<ResumePendingRoastSaveDeps> = {}): ResumePendingRoastSaveDeps => ({
    pending: createPendingRoastSave(params, true),
    ownerId: 'owner',
    ensureAccess: vi.fn(async () => {}),
    findSession: vi.fn(async () => null),
    resolveForRoast: vi.fn(async () => row),
    saveRoast: vi.fn(async () => ({ savedSession: saved, shouldOpenContinue: true })),
    syncBatch: vi.fn(async () => {}),
    refreshCaches: vi.fn(async () => {}),
    syncRoastCurve: vi.fn(async () => {}),
    ...patch,
});
function deferred() {
    let resolve = () => {};
    let reject = (_error: Error) => {};
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});
describe('shared durable save coordinator', () => {
    it.each([false, true])('uploads captured preheat with its roast (live persistence: %s)', async (recording) => {
        const bbpCapture = {
            sessionId: ID,
            generation: recording ? 'wait' : '',
            startMs: 1000,
            chargeMs: 4000,
            recording,
            points: [0, 1, 2].map((t) => ({ t, bt: 200, et: null, heater: 0, fan: 0, drum: 0 })),
            events: [],
        };
        const bbp = splitBatchBbp(bbpCapture).bbp;
        const d = deps({
            pending: createPendingRoastSave(
                {
                    ...params,
                    bbpCapture,
                    bbpSummary: bbp ? { ...bbp, sessionId: ID } : null,
                },
                true,
            ),
        });
        await resumePendingRoastSave(d);
        expect(d.saveRoast).toHaveBeenCalledWith(expect.objectContaining({ bbpCapture }));
        expect(d.syncRoastCurve).toHaveBeenCalledWith({
            sessionId: ID,
            roastSessionId: ID,
            ownerId: 'owner',
            profileRequired: true,
            bbpRequired: true,
        });
    });

    it('passes form-selected bean through saveRoast on resume', async () => {
        const d = deps({
            pending: createPendingRoastSave(
                {
                    ...params,
                    formData: { ...params.formData, beanId: 'form-picked', weightGrams: 5 },
                    selectedBeanId: 'stale-header',
                    planBatchHandoff: null,
                },
                true,
            ),
        });
        await resumePendingRoastSave(d);
        expect(d.saveRoast).toHaveBeenCalledWith(
            expect.objectContaining({
                formData: expect.objectContaining({ beanId: 'form-picked' }),
                selectedBeanId: 'stale-header',
            }),
        );
    });

    it('persists before auth and passes stock intent to the server with the resolved batch and same UUID', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-28T08:00:00.000Z'));
        const d = deps();
        d.ensureAccess = vi.fn(async () => {
            expect(readPendingRoastSave('owner', ID)?.submitted).toBe(true);
        });
        try {
            await resumePendingRoastSave(d);
            expect(d.saveRoast).toHaveBeenCalledWith(
                expect.objectContaining({
                    sessionId: ID,
                    userId: 'owner',
                    roastStartTime: 1234,
                    planBatchHandoff: expect.objectContaining({ planBatchId: BATCH }),
                    formData: expect.objectContaining({ deductStock: true }),
                }),
            );
            expect(readPendingRoastSave('owner', ID)).toBeNull();
            expect(Date.now()).not.toBe(1234);
        } finally {
            vi.useRealTimers();
        }
    });
    it.each(['batch', 'curve'] as const)(
        'runs progress and upload together; refresh waits when %s finishes first',
        async (first) => {
            const batch = deferred();
            const curve = deferred();
            const refresh = deferred();
            const d = deps({
                syncBatch: vi.fn(() => batch.promise),
                syncRoastCurve: vi.fn(() => curve.promise),
                refreshCaches: vi.fn(() => refresh.promise),
            });
            const work = resumePendingRoastSave(d);
            await vi.waitFor(() => {
                expect(d.syncBatch).toHaveBeenCalledWith(saved);
                expect(d.syncRoastCurve).toHaveBeenCalledTimes(1);
            });
            expect(readPendingRoastSave('owner', ID)?.db).toBe('saved');
            (first === 'batch' ? batch : curve).resolve();
            await vi.waitFor(() =>
                expect(readPendingRoastSave('owner', ID)?.[first === 'batch' ? 'batch' : 'profile']).toBe('synced'),
            );
            expect(d.refreshCaches).not.toHaveBeenCalled();
            expect(isPendingRoastSaveActive('owner', ID)).toBe(true);
            (first === 'batch' ? curve : batch).resolve();
            await vi.waitFor(() => expect(d.refreshCaches).toHaveBeenCalledExactlyOnceWith(saved));
            expect(readPendingRoastSave('owner', ID)).not.toBeNull();
            expect(isPendingRoastSaveActive('owner', ID)).toBe(true);
            refresh.resolve();
            await work;
            expect(readPendingRoastSave('owner', ID)).toBeNull();
            expect(isPendingRoastSaveActive('owner', ID)).toBe(false);
        },
    );
    it.each(['batch', 'curve'] as const)(
        'keeps recovery locked after %s fails until the other stage and refresh settle',
        async (failed) => {
            const batch = deferred();
            const curve = deferred();
            const refresh = deferred();
            const d = deps({
                syncBatch: vi.fn(() => batch.promise),
                syncRoastCurve: vi.fn(() => curve.promise),
                refreshCaches: vi.fn(() => refresh.promise),
            });
            const work = resumePendingRoastSave(d);
            await vi.waitFor(() => expect(d.syncRoastCurve).toHaveBeenCalledTimes(1));
            (failed === 'batch' ? batch : curve).reject(new Error(`${failed} failed`));
            await Promise.resolve();
            expect(isPendingRoastSaveActive('owner', ID)).toBe(true);
            expect(resumePendingRoastSave(d)).toBe(work);
            expect(d.refreshCaches).not.toHaveBeenCalled();
            (failed === 'batch' ? curve : batch).resolve();
            await vi.waitFor(() => expect(d.refreshCaches).toHaveBeenCalledExactlyOnceWith(saved));
            expect(isPendingRoastSaveActive('owner', ID)).toBe(true);
            refresh.resolve();
            expect((await work).syncPending).toBe(true);
            expect(isPendingRoastSaveActive('owner', ID)).toBe(false);
            const kept = readPendingRoastSave('owner', ID);
            if (!kept) throw new Error('Missing pending snapshot');
            expect(kept.batch).toBe(failed === 'batch' ? 'pending' : 'synced');
            expect(kept.profile).toBe(failed === 'curve' ? 'pending' : 'synced');
            expect(kept.error).toBe(`${failed} failed`);
            const retry = deps({ pending: kept, findSession: vi.fn(async () => saved) });
            await resumePendingRoastSave(retry);
            expect(retry.saveRoast).not.toHaveBeenCalled();
            expect(retry.resolveForRoast).not.toHaveBeenCalled();
            expect(retry.syncBatch).toHaveBeenCalledTimes(failed === 'batch' ? 1 : 0);
            expect(retry.syncRoastCurve).toHaveBeenCalledTimes(failed === 'curve' ? 1 : 0);
            expect(retry.refreshCaches).toHaveBeenCalledExactlyOnceWith(saved);
        },
    );
    it('retains completed stages when final cache refresh fails and retries only that refresh', async () => {
        const d = deps({
            refreshCaches: vi.fn(async () => {
                throw new Error('refresh failed');
            }),
        });
        expect((await resumePendingRoastSave(d)).syncPending).toBe(true);
        const kept = readPendingRoastSave('owner', ID);
        if (!kept) throw new Error('Missing pending snapshot');
        expect(kept).toMatchObject({ db: 'saved', batch: 'synced', profile: 'synced', error: 'refresh failed' });
        const retry = deps({ pending: kept, findSession: vi.fn(async () => saved) });
        await resumePendingRoastSave(retry);
        expect(retry.saveRoast).not.toHaveBeenCalled();
        expect(retry.syncBatch).not.toHaveBeenCalled();
        expect(retry.syncRoastCurve).not.toHaveBeenCalled();
        expect(retry.refreshCaches).toHaveBeenCalledExactlyOnceWith(saved);
    });
    it.each(['same-root', 'cross-root'] as const)(
        'retains pending after a real refetch failure until every sibling settles (%s first)',
        async (first) => {
            const sameRoot = deferred();
            const crossRoot = deferred();
            const onQueryError = vi.fn();
            const capture = vi.spyOn(logger, 'capture').mockImplementation(() => {});
            const qc = new QueryClient({
                queryCache: new QueryCache({ onError: onQueryError }),
                defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
            });
            const failedRead = vi
                .fn()
                .mockResolvedValueOnce(0)
                .mockRejectedValueOnce(new Error('network refetch failed'))
                .mockResolvedValue(1);
            const sameRootRead = vi
                .fn(async () => {
                    await sameRoot.promise;
                    return 1;
                })
                .mockResolvedValueOnce(0);
            const crossRootRead = vi
                .fn(async () => {
                    await crossRoot.promise;
                    return 1;
                })
                .mockResolvedValueOnce(0);
            await Promise.all([
                qc.fetchQuery({ queryKey: roastSessionKeys.all('owner'), queryFn: failedRead }),
                qc.fetchQuery({
                    queryKey: roastSessionKeys.detail('owner', ID),
                    queryFn: sameRootRead,
                }),
                qc.fetchQuery({ queryKey: dashboardKeys.all('owner'), queryFn: crossRootRead }),
            ]);
            const invalidations = vi.spyOn(qc, 'invalidateQueries');
            const d = deps({ refreshCaches: vi.fn((session) => refreshCachesAfterRoastSave(qc, session)) });
            let settled = false;
            const activeWork = resumePendingRoastSave(d);
            const work = activeWork.then((result) => {
                settled = true;
                return result;
            });
            await vi.waitFor(() => {
                expect(onQueryError).toHaveBeenCalledTimes(1);
                expect(sameRootRead).toHaveBeenCalledTimes(2);
                expect(crossRootRead).toHaveBeenCalledTimes(2);
            });
            (first === 'same-root' ? sameRoot : crossRoot).resolve();
            await vi.waitFor(() =>
                expect(
                    qc.getQueryState(
                        first === 'same-root' ? roastSessionKeys.detail('owner', ID) : dashboardKeys.all('owner'),
                    )?.fetchStatus,
                ).toBe('idle'),
            );
            expect(settled).toBe(false);
            expect(isPendingRoastSaveActive('owner', ID)).toBe(true);
            expect(readPendingRoastSave('owner', ID)).toMatchObject({
                db: 'saved',
                batch: 'synced',
                profile: 'synced',
            });
            expect(resumePendingRoastSave(d)).toBe(activeWork);
            (first === 'same-root' ? crossRoot : sameRoot).resolve();
            expect((await work).syncPending).toBe(true);
            expect(isPendingRoastSaveActive('owner', ID)).toBe(false);
            const kept = readPendingRoastSave('owner', ID);
            if (!kept) throw new Error('Missing pending snapshot');
            expect(kept.error).toBe('network refetch failed');
            expect(capture).not.toHaveBeenCalled();
            for (const queryKey of [inventoryQueryRoots.beanStockEvents, roastedStockKeys.byUser('owner')]) {
                expect(invalidations).toHaveBeenCalledWith({ queryKey, refetchType: 'all' });
            }
            const retry = deps({
                pending: kept,
                findSession: vi.fn(async () => saved),
                refreshCaches: vi.fn((session) => refreshCachesAfterRoastSave(qc, session)),
            });
            expect((await resumePendingRoastSave(retry)).syncPending).toBeUndefined();
            expect(readPendingRoastSave('owner', ID)).toBeNull();
            expect(retry.saveRoast).not.toHaveBeenCalled();
            expect(retry.resolveForRoast).not.toHaveBeenCalled();
            expect(retry.syncBatch).not.toHaveBeenCalled();
            expect(retry.syncRoastCurve).not.toHaveBeenCalled();
            expect(retry.refreshCaches).toHaveBeenCalledExactlyOnceWith(saved);
            expect(failedRead).toHaveBeenCalledTimes(3);
            expect(onQueryError).toHaveBeenCalledTimes(1);
            expect(capture).not.toHaveBeenCalled();
            qc.clear();
        },
    );
    it('waits for the other stage when persisting a successful stage fails', async () => {
        const batch = deferred();
        const curve = deferred();
        const d = deps({
            syncBatch: vi.fn(() => batch.promise),
            syncRoastCurve: vi.fn(() => curve.promise),
        });
        const work = resumePendingRoastSave(d);
        await vi.waitFor(() => expect(d.syncRoastCurve).toHaveBeenCalledTimes(1));
        vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new Error('checkpoint failed');
        });
        batch.resolve();
        await Promise.resolve();
        expect(isPendingRoastSaveActive('owner', ID)).toBe(true);
        expect(resumePendingRoastSave(d)).toBe(work);
        expect(d.refreshCaches).not.toHaveBeenCalled();
        curve.resolve();
        expect((await work).syncPending).toBe(true);
        expect(d.refreshCaches).toHaveBeenCalledExactlyOnceWith(saved);
        expect(readPendingRoastSave('owner', ID)).toMatchObject({
            db: 'saved',
            profile: 'synced',
            error: 'checkpoint failed',
        });
        expect(isPendingRoastSaveActive('owner', ID)).toBe(false);
    });
    it('already committed sessions bypass resolver/quota/save and only synchronize', async () => {
        const d = deps({ findSession: vi.fn(async () => saved) });
        await resumePendingRoastSave(d);
        expect(d.resolveForRoast).not.toHaveBeenCalled();
        expect(d.saveRoast).not.toHaveBeenCalled();
        expect(d.syncBatch).toHaveBeenCalledWith(saved);
    });
    it('reconciles committed unlinked sessions without replaying the save', async () => {
        const unlinked = { ...saved, plan_batch_id: null };
        const d = deps({ findSession: vi.fn(async () => unlinked) });
        await resumePendingRoastSave(d);
        expect(d.saveRoast).not.toHaveBeenCalled();
        expect(d.syncBatch).not.toHaveBeenCalled();
        expect(d.refreshCaches).toHaveBeenCalledWith(unlinked);
        expect(readPendingRoastSave('owner', ID)).toBeNull();
    });
    it('lost RPC response is recovered with the identical session ID', async () => {
        const find = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(saved);
        const d = deps({
            findSession: find,
            saveRoast: vi.fn(async () => {
                throw new Error('timeout');
            }),
        });
        expect((await resumePendingRoastSave(d)).savedSession).toEqual(saved);
        expect(find.mock.calls).toEqual([[ID], [ID]]);
    });
    it('lookup failure is never treated as absent', async () => {
        const d = deps({
            findSession: vi.fn(async () => {
                throw new Error('network');
            }),
        });
        await expect(resumePendingRoastSave(d)).rejects.toThrow('network');
        expect(d.saveRoast).not.toHaveBeenCalled();
        expect(d.syncRoastCurve).not.toHaveBeenCalled();
        expect(readPendingRoastSave('owner', ID)).not.toBeNull();
    });
    it.each(['22P02', '23503', '23514'])('preserves %s snapshot as needs-attention', async (code) => {
        const d = deps({
            saveRoast: vi.fn(async () => {
                throw { code, message: 'invalid input' };
            }),
        });
        await expect(resumePendingRoastSave(d)).rejects.toMatchObject({ code });
        expect(readPendingRoastSave('owner', ID)?.needsAttention).toBe(true);
    });
    it('rejects changed actual bean/blend and completed batches without saving', async () => {
        for (const changed of [
            { ...row, bean_id: 'different' },
            { ...row, completed_sessions: 2 },
        ]) {
            const d = deps({ resolveForRoast: vi.fn(async () => changed) });
            await expect(resumePendingRoastSave(d)).rejects.toMatchObject({ code: 'unresolvable_plan_batch_id' });
            expect(d.saveRoast).not.toHaveBeenCalled();
        }
    });
    it('does not clear pending or redo inventory after artifact failure', async () => {
        const d = deps({
            syncRoastCurve: vi.fn(async () => {
                throw new Error('BBP upload failed');
            }),
        });
        expect((await resumePendingRoastSave(d)).syncPending).toBe(true);
        const kept = readPendingRoastSave('owner', ID);
        if (!kept) throw new Error('Missing pending snapshot');
        expect(kept.db).toBe('saved');
        const retry = deps({ pending: kept, findSession: vi.fn(async () => saved) });
        await resumePendingRoastSave(retry);
        expect(retry.saveRoast).not.toHaveBeenCalled();
    });
    it('coalesces concurrent saves for the same owner/session', async () => {
        const d = deps();
        await Promise.all([resumePendingRoastSave(d), resumePendingRoastSave(d)]);
        expect(d.saveRoast).toHaveBeenCalledTimes(1);
    });
    it('a durable write failure stops all network writes', async () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        const d = deps();
        await expect(resumePendingRoastSave(d)).rejects.toThrow('quota');
        expect(d.ensureAccess).not.toHaveBeenCalled();
        expect(d.saveRoast).not.toHaveBeenCalled();
    });
    it('foreign or noncompleted saved row is a conflict, never a new save', async () => {
        const d = deps({ findSession: vi.fn(async () => ({ ...saved, user_id: 'other' })) });
        await expect(resumePendingRoastSave(d)).rejects.toMatchObject({ code: 'unresolvable_plan_batch_id' });
        expect(d.saveRoast).not.toHaveBeenCalled();
    });
});
