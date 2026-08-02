import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearPendingRoastSave,
    type PendingRoastParams,
    type PendingRoastSave,
    readPendingRoastSave,
    toSaveRoastParams,
    writePendingRoastSave,
} from './pendingRoastSave';

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

const params: PendingRoastParams = {
    formData: {
        notes: 'n',
        weightGrams: 1.5,
        roastLevel: null,
        beanId: null,
        beanLabel: null,
        linkedBatch: null,
        deductStock: false,
    },
    userId: 'u1',
    elapsed: 600,
    roastStartTime: 1234,
    rawBT: 205,
    ambientTemperature: null,
    ambientHumidity: null,
    selectedBeanId: null,
    targetProfileId: null,
    planBatchHandoff: null,
    sessionId: 's1',
    handoffBeanName: null,
    logEntries: [],
};

const pending: PendingRoastSave = { version: 1, submitted: true, params };

describe('pendingRoastSave', () => {
    it('write → read 라운드트립', () => {
        writePendingRoastSave(pending);
        expect(readPendingRoastSave()).toEqual(pending);
    });

    it('없으면 null', () => {
        expect(readPendingRoastSave()).toBeNull();
    });

    it('손상된 JSON → null (throw 없음)', () => {
        store.set(KEY, '{broken');
        expect(readPendingRoastSave()).toBeNull();
    });

    it('버전 불일치 → null', () => {
        store.set(KEY, JSON.stringify({ ...pending, version: 99 }));
        expect(readPendingRoastSave()).toBeNull();
    });

    it('clear 후 null', () => {
        writePendingRoastSave(pending);
        clearPendingRoastSave();
        expect(readPendingRoastSave()).toBeNull();
    });

    it('toSaveRoastParams: roastStartTime → ref 복원', () => {
        const live = toSaveRoastParams(params);
        expect(live.roastStartTimeRef.current).toBe(1234);
        expect('roastStartTime' in live).toBe(false);
        expect(live.sessionId).toBe('s1');
    });
});
