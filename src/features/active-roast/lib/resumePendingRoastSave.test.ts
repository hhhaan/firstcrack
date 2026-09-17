import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearPendingRoastSave,
    type PendingRoastParams,
    type PendingRoastSave,
    readPendingRoastSave,
    writePendingRoastSave,
} from '../model/pendingRoastSave';
import type { SaveRoastResult } from '../model/useSaveRoast';
import { resumePendingRoastSave } from './resumePendingRoastSave';
import { startNextFromContinue } from './startNextFromContinue';

const RULE = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const REAL = '11111111-1111-4111-8111-111111111111';
const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = 'owner-1';

const virtualId = `${RULE}:2026-09-01`;

const virtualRow = (over: Partial<PlanBatchWithProgress> = {}): PlanBatchWithProgress =>
    ({
        id: virtualId,
        plan_id: '',
        bean_id: 'bean-1',
        blend_id: null,
        bean_name: 'Kenya',
        batch_size_kg: 5,
        roast_profile_id: null,
        batch_count: 2,
        completed_sessions: 0,
        recurrence_rule_id: RULE,
        scheduled_date: '2026-09-01',
        original_date: '2026-09-01',
        ...over,
    }) as PlanBatchWithProgress;

const realRow = (): PlanBatchWithProgress =>
    ({
        ...virtualRow(),
        id: REAL,
        plan_id: 'plan-1',
        completed_sessions: 0,
    }) as PlanBatchWithProgress;

const virtualHandoff = (): PlanBatchHandoff => ({
    planBatchId: virtualId,
    planId: '',
    beanId: 'bean-1',
    blendId: null,
    beanName: 'Kenya',
    batchSizeKg: 5,
    profileId: null,
    batchCount: 2,
    completedSessions: 0,
});

const params = (over: Partial<PendingRoastParams> = {}): PendingRoastParams => ({
    formData: {
        notes: '',
        weightGrams: 5,
        roastLevel: null,
        beanId: 'bean-1',
        beanLabel: null,
        linkedBatch: null,
        deductStock: false,
    },
    userId: OWNER,
    elapsed: 600,
    roastStartTime: 1234,
    rawBT: 205,
    ambientTemperature: null,
    ambientHumidity: null,
    selectedBeanId: 'bean-1',
    targetProfileId: null,
    planBatchHandoff: virtualHandoff(),
    sessionId: SESSION,
    handoffBeanName: 'Kenya',
    logEntries: [],
    ...over,
});

const KEY = 'fc_pending_roast_save';
const store = new Map<string, string>();

beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;
});

describe('startNextFromContinue', () => {
    it('materializes only the selected virtual row before startBatch', async () => {
        const resolveForRoast = vi.fn(async () => realRow());
        const handoff = await startNextFromContinue(OWNER, virtualRow(), resolveForRoast);

        expect(resolveForRoast).toHaveBeenCalledTimes(1);
        expect(resolveForRoast).toHaveBeenCalledWith(OWNER, expect.objectContaining({ id: virtualId }));
        expect(handoff.planBatchId).toBe(REAL);
        expect(handoff.planId).toBe('plan-1');
    });
});

describe('resumePendingRoastSave', () => {
    it('resolves a virtual handoff to a real uuid before saveOp, keeping the session id', async () => {
        const pending: PendingRoastSave = { version: 1, submitted: true, params: params() };
        writePendingRoastSave(pending);

        const resolveForRoast = vi.fn(async () => realRow());
        const saveRoast = vi.fn(async (live) => {
            expect(live.sessionId).toBe(SESSION);
            expect(live.planBatchHandoff?.planBatchId).toBe(REAL);
            return { savedSession: { id: SESSION }, shouldOpenContinue: true } as SaveRoastResult;
        });

        await resumePendingRoastSave({
            pending,
            ownerId: OWNER,
            resolveForRoast,
            saveRoast,
        });

        expect(resolveForRoast).toHaveBeenCalledTimes(1);
        expect(saveRoast).toHaveBeenCalledTimes(1);
        const rewritten = readPendingRoastSave();
        expect(rewritten?.params.sessionId).toBe(SESSION);
        expect(rewritten?.params.planBatchHandoff?.planBatchId).toBe(REAL);
    });

    it('keeps the same session uuid and does not clear a 22P02 snapshot', async () => {
        const pending: PendingRoastSave = { version: 1, submitted: true, params: params() };
        writePendingRoastSave(pending);

        const resolveForRoast = vi.fn(async () => realRow());
        const saveRoast = vi.fn(async () => {
            throw { code: '22P02', message: 'invalid input syntax for type uuid' };
        });

        await expect(
            resumePendingRoastSave({
                pending,
                ownerId: OWNER,
                resolveForRoast,
                saveRoast,
            }),
        ).rejects.toMatchObject({ code: '22P02' });

        const kept = readPendingRoastSave();
        expect(kept).not.toBeNull();
        expect(kept?.params.sessionId).toBe(SESSION);
        expect(kept?.needsAttention).toBe(true);
        expect(store.has(KEY)).toBe(true);
        expect(readPendingRoastSave()?.params.sessionId).toBe(SESSION);
        clearPendingRoastSave();
        expect(readPendingRoastSave()).toBeNull();
    });
});
