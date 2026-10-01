import { canCancelDrop } from '@features/active-roast/lib/drop-transition';
import { completedKey } from '@features/active-roast/model/completed';
import { useRoastingStore } from '@features/active-roast/model/status';
import { beforeEach, describe, expect, it } from 'vitest';
import { isDropCancelable, useCompletedRoastStore } from './completedRoast';
import type { LiveRoastPoint } from './useSidecarPolling';

const restore = {
    sessionId: 's-a',
    roastStartMs: 1_000,
    elapsed: 600,
    logEntries: [],
    livePoints: [] as LiveRoastPoint[],
    sessionOwnerId: 'owner',
};

describe('completed roast Drop-cancel boundary', () => {
    beforeEach(() => {
        useCompletedRoastStore.getState().clear();
        useRoastingStore.getState().reset();
    });

    it('cancel is allowed after Drop before Charge or save', () => {
        useCompletedRoastStore.getState().capture(restore);
        expect(isDropCancelable()).toBe(true);
        expect(canCancelDrop({ nextCharged: false, submitted: false })).toBe(true);
    });

    it('server save locks cancel', () => {
        useCompletedRoastStore.getState().capture(restore);
        useCompletedRoastStore.getState().markSubmitted('s-a');
        expect(useCompletedRoastStore.getState().restore).toBeNull();
        expect(isDropCancelable()).toBe(false);
    });

    it('next Charge locks cancel and does not rewind B', () => {
        useCompletedRoastStore.getState().capture(restore);
        useRoastingStore.setState({ phase: 'roasting', sessionId: 's-b' });
        expect(isDropCancelable()).toBe(false);
        useCompletedRoastStore.getState().lockAfterCharge('s-b');
        expect(useCompletedRoastStore.getState().restore).toBeNull();
        expect(isDropCancelable()).toBe(false);
    });
});

it('locks only the saving owner/session and preserves another completed batch', () => {
    const store = useRoastingStore.getState();
    store.clear();
    store.capture(restore);
    store.capture({ ...restore, sessionId: 's-b' });
    const keyA = completedKey('owner', 's-a');
    const keyB = completedKey('owner', 's-b');
    expect(store.beginCompletedSave(keyA)).toBe(true);
    expect(store.beginCompletedSave(keyA)).toBe(false);
    expect(store.discardCompleted(keyA)).toBe(false);
    expect(isDropCancelable(keyA)).toBe(false);
    store.markSubmitted('s-a', 'owner');
    expect(useRoastingStore.getState().completedRecords[keyB].restore?.sessionId).toBe('s-b');
    expect(useRoastingStore.getState().completedRecords[keyB].submitted).toBe(false);
    expect(isDropCancelable(keyB)).toBe(true);
});

it('rejects duplicate, backward, and stale-clock wait points without filling gaps', () => {
    const store = useRoastingStore.getState();
    store.clear();
    store.capture(restore);
    const point = {
        time: 0,
        label: '',
        bt: 200,
        et: null,
        ror: null,
        ror_et: null,
        heater: null,
        fan: 0,
        drum: 0,
        sensorTimestamp: 1,
        sensorClock: 'clock',
    };
    store.appendCompletedWait(point, 602_000);
    store.appendCompletedWait(point, 603_000);
    store.appendCompletedWait({ ...point, sensorTimestamp: 2 }, 602_100);
    store.appendCompletedWait({ ...point, sensorTimestamp: 3 }, 610_000);
    const record = useRoastingStore.getState().completedRecords[completedKey('owner', 's-a')];
    expect(record.waitPoints.map((p) => p.time)).toEqual([601, 609]);
});
