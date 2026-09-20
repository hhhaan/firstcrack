// @vitest-environment jsdom
import type { PlanBatchHandoff, PlanBatchWithProgress, RoastSession } from '@shared/types/database.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPendingRoastSave, type PendingRoastParams, readPendingRoastSave } from '../model/pendingRoastSave';
import { type ResumePendingRoastSaveDeps, resumePendingRoastSave } from './resumePendingRoastSave';

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
    syncRoastCurve: vi.fn(async () => {}),
    hasBatchDeduction: vi.fn(async () => false),
    ...patch,
});
beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});
describe('shared durable save coordinator', () => {
    it('persists before auth and resolves before F3/RPC with the same UUID', async () => {
        const d = deps();
        d.ensureAccess = vi.fn(async () => {
            expect(readPendingRoastSave('owner', ID)?.submitted).toBe(true);
        });
        d.hasBatchDeduction = vi.fn(async (id) => {
            expect(id).toBe(BATCH);
            return true;
        });
        await resumePendingRoastSave(d);
        expect(d.saveRoast).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: ID,
                userId: 'owner',
                planBatchHandoff: expect.objectContaining({ planBatchId: BATCH }),
                formData: expect.objectContaining({ deductStock: false }),
            }),
        );
        expect(readPendingRoastSave('owner', ID)).toBeNull();
    });
    it('refreshes caches once after save and before curve sync', async () => {
        const order: string[] = [];
        const d = deps({
            saveRoast: vi.fn(async () => {
                order.push('save');
                return { savedSession: saved, shouldOpenContinue: true };
            }),
            syncBatch: vi.fn(async () => {
                order.push('syncBatch');
            }),
            syncRoastCurve: vi.fn(async () => {
                order.push('curve');
            }),
        });
        await resumePendingRoastSave(d);
        expect(order).toEqual(['save', 'syncBatch', 'curve']);
        expect(d.syncBatch).toHaveBeenCalledTimes(1);
        expect(d.syncRoastCurve).toHaveBeenCalledTimes(1);
    });
    it('already committed sessions bypass resolver/F3/quota/save and only synchronize', async () => {
        const d = deps({ findSession: vi.fn(async () => saved) });
        await resumePendingRoastSave(d);
        expect(d.resolveForRoast).not.toHaveBeenCalled();
        expect(d.hasBatchDeduction).not.toHaveBeenCalled();
        expect(d.saveRoast).not.toHaveBeenCalled();
        expect(d.syncBatch).toHaveBeenCalledWith(saved);
    });
    it('reconciles committed unlinked sessions without replaying the save', async () => {
        const unlinked = { ...saved, plan_batch_id: null };
        const d = deps({ findSession: vi.fn(async () => unlinked) });
        await resumePendingRoastSave(d);
        expect(d.saveRoast).not.toHaveBeenCalled();
        expect(d.syncBatch).toHaveBeenCalledWith(unlinked);
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
