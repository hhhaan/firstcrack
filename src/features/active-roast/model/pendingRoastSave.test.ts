// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearPendingRoastSave,
    createPendingRoastSave,
    listPendingRoastSaves,
    type PendingRoastParams,
    readPendingRoastSave,
    writePendingRoastSave,
} from './pendingRoastSave';

const params: PendingRoastParams = {
    formData: { notes: '', weightGrams: 1, roastLevel: null, beanId: null },
    userId: 'owner',
    elapsed: 600,
    roastStartTime: 1234,
    rawBT: 205,
    selectedBeanId: null,
    targetProfileId: null,
    planBatchHandoff: null,
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    handoffBeanName: null,
    logEntries: [],
};
beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});
describe('durable per-session recovery', () => {
    it('clearing A preserves B and foreign-owner A', () => {
        const a = createPendingRoastSave(params, true);
        const b = createPendingRoastSave({ ...params, sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, true);
        const foreign = createPendingRoastSave({ ...params, userId: 'other' }, true);
        for (const p of [a, b, foreign]) writePendingRoastSave(p);
        clearPendingRoastSave(params.userId, params.sessionId);
        expect(listPendingRoastSaves()).toEqual([b, foreign]);
    });
    it('allocates one durable UUID for an unrecorded roast and records no required profile', () => {
        const p = createPendingRoastSave({ ...params, sessionId: null }, true);
        writePendingRoastSave(p);
        expect(p.params.sessionId).toMatch(/^[a-f0-9-]{36}$/);
        expect(readPendingRoastSave('owner', p.params.sessionId)).toEqual(p);
        expect(p.profile).toBe('not_required');
    });
    it('migrates legacy only after a verified durable write', () => {
        const legacy = JSON.stringify({ version: 1, submitted: true, params });
        localStorage.setItem('fc_pending_roast_save', legacy);
        const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        expect(listPendingRoastSaves).toThrow('quota');
        expect(localStorage.getItem('fc_pending_roast_save')).toBe(legacy);
        set.mockRestore();
        expect(listPendingRoastSaves()[0].params.sessionId).toBe(params.sessionId);
        expect(localStorage.getItem('fc_pending_roast_save')).toBeNull();
    });
    it('preserves corrupt and unknown legacy data for recovery', () => {
        localStorage.setItem('fc_pending_roast_save', '{broken');
        expect(listPendingRoastSaves).toThrow();
        expect(localStorage.getItem('fc_pending_roast_save')).toBe('{broken');
    });
    it('never invents a new identity for an ambiguous legacy null ID', () => {
        localStorage.setItem(
            'fc_pending_roast_save',
            JSON.stringify({ version: 1, submitted: true, params: { ...params, sessionId: null } }),
        );
        const p = listPendingRoastSaves()[0];
        expect(p.params.sessionId).toBeNull();
        expect(p.needsAttention).toBe(true);
    });
});
