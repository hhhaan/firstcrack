import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearLiveRoastDraft,
    LIVE_ROAST_DRAFT_KEY,
    type LiveRoastDraft,
    readLiveRoastDraft,
    scheduleLiveRoastDraftWrite,
    writeLiveRoastDraft,
} from './liveRoastDraft';

const store = new Map<string, string>();

beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;
});

afterEach(() => {
    clearLiveRoastDraft();
    vi.useRealTimers();
});

const draft: LiveRoastDraft = {
    version: 1,
    sessionId: 's1',
    roastStartMs: 1_700_000_000_000,
    elapsed: 480,
    livePoints: [{ time: 12, label: '0:12', bt: 180, et: 200, ror: 8, ror_et: 7, heater: 70, fan: 40, drum: 50 }],
    logEntries: [{ time: '0:00', timeSec: 0, event: 'Charge', temp: '180', tempC: 180, note: 'Bean drop detected' }],
    updatedAt: 1_700_000_480_000,
};

describe('liveRoastDraft', () => {
    it('write → read 라운드트립', () => {
        writeLiveRoastDraft(draft);
        expect(readLiveRoastDraft()).toEqual(draft);
    });

    it('손상된 JSON → null (throw 없음)', () => {
        store.set(LIVE_ROAST_DRAFT_KEY, '{broken');
        expect(readLiveRoastDraft()).toBeNull();
    });

    it('버전 불일치 → null', () => {
        store.set(LIVE_ROAST_DRAFT_KEY, JSON.stringify({ ...draft, version: 99 }));
        expect(readLiveRoastDraft()).toBeNull();
    });

    it('clear 후 null', () => {
        writeLiveRoastDraft(draft);
        clearLiveRoastDraft();
        expect(readLiveRoastDraft()).toBeNull();
    });

    it('scheduleLiveRoastDraftWrite coalesces to the last draft', () => {
        vi.useFakeTimers();
        scheduleLiveRoastDraftWrite({ ...draft, elapsed: 1 });
        scheduleLiveRoastDraftWrite({ ...draft, elapsed: 2 });
        expect(readLiveRoastDraft()).toBeNull();
        vi.advanceTimersByTime(200);
        expect(readLiveRoastDraft()?.elapsed).toBe(2);
    });
});
