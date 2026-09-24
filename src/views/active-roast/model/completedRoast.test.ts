import { canCancelDrop } from '@features/active-roast/lib/drop-transition';
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
        useRoastingStore.setState({ charged: true, sessionId: 's-b' });
        useCompletedRoastStore.getState().lockAfterCharge('s-b');
        expect(useCompletedRoastStore.getState().restore).toBeNull();
        expect(isDropCancelable()).toBe(false);
    });
});
