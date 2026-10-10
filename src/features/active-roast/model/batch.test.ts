import type { LiveRoastPoint } from '@shared/types/roast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectDropCancelable, selectRoastSelection } from './batch';
import { useRoastingStore } from './status';

const point = (time: number): LiveRoastPoint => ({
    time,
    label: `${time}`,
    bt: 200,
    et: 210,
    ror: 1,
    ror_et: 1,
    heater: 50,
    fan: 40,
    drum: 60,
});
const charge = () => {
    const state = useRoastingStore.getState();
    state.enterPreheating();
    state.prepareWorkspace('owner');
    state.prepareBean('bean-a', 'Lot A');
    state.commitProfile('profile-a', null, 'owner');
    state.startCharge(Date.now() - 600_000, 'owner', { bt: 180, unit: 'C' });
    state.setLivePoints([point(0), point(600), point(610)]);
};
const drop = () =>
    useRoastingStore.getState().drop({ rawBT: 200, unit: 'C', replayActive: true, onset: { timeSec: 600, bt: 200 } });

describe('central batch ownership and transitions', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-04T00:10:00Z'));
        useRoastingStore.getState().reset();
    });
    afterEach(() => vi.useRealTimers());

    it('publishes Charge identity, selection and log together, once for manual/auto duplicates', () => {
        const state = useRoastingStore.getState();
        state.prepareBean('bean-a');
        const observations: { id: string | null; bean: string | null; logs: number }[] = [];
        const unsubscribe = useRoastingStore.subscribe((next) =>
            observations.push({
                id: next.sessionId,
                bean: next.activeSelection?.beanId ?? null,
                logs: next.logState.entries.length,
            }),
        );
        const sessionId = state.startCharge(undefined, 'owner', { bt: 180, unit: 'C' });
        expect(state.startCharge()).toBeNull();
        unsubscribe();
        expect(observations).toEqual([{ id: sessionId, bean: 'bean-a', logs: 1 }]);
    });

    it('keeps running selection separate from defaults, pending handoff and workspace preparation', () => {
        charge();
        const state = useRoastingStore.getState();
        state.initializeBean('default');
        state.initializeProfile('default');
        state.setPendingBean('older-bean', 'Older selection');
        state.startBatch({
            planBatchId: 'batch-b',
            planId: 'plan',
            beanId: 'bean-b',
            blendId: null,
            beanName: 'Lot B',
            profileId: 'profile-b',
            batchSizeKg: 1,
            batchCount: 1,
            completedSessions: 0,
        });
        expect(selectRoastSelection(useRoastingStore.getState())).toMatchObject({
            beanId: 'bean-a',
            profileId: 'profile-a',
        });
        expect(useRoastingStore.getState().prepared.beanId).toBe('bean-b');
        expect(useRoastingStore.getState().pendingBeanId).toBeNull();
        state.prepareWorkspace('other-owner');
        expect(useRoastingStore.getState().sessionOwnerId).toBe('owner');
        expect(selectRoastSelection(useRoastingStore.getState()).beanId).toBe('bean-a');
    });

    it('rejects stale approved selection and carries approved running reference into next preparation', () => {
        charge();
        const state = useRoastingStore.getState();
        expect(state.commitProfile('stale', 'other-session', 'owner')).toBe(false);
        expect(state.commitProfile('stale', state.sessionId, 'other-owner')).toBe(false);
        expect(state.commitProfile('approved', state.sessionId, 'owner')).toBe(true);
        expect(useRoastingStore.getState().activeSelection?.profileId).toBe('approved');
        expect(useRoastingStore.getState().prepared.profileId).toBe('approved');
    });

    it('freezes Drop and releases the machine in a single memory update', () => {
        charge();
        const updates: boolean[] = [];
        const unsubscribe = useRoastingStore.subscribe((state) =>
            updates.push(
                Boolean(
                    state.completed?.summary &&
                        state.sessionId === null &&
                        state.livePoints.length === 0 &&
                        state.heatHoldAfterDrop &&
                        state.awaitingNextCharge,
                ),
            ),
        );
        const result = drop();
        unsubscribe();
        expect(updates).toEqual([true]);
        expect(result?.snapshot.selection).toMatchObject({ beanId: 'bean-a', profileId: 'profile-a' });
        expect(result?.snapshot.livePoints.map((p) => p.time)).toEqual([0, 600]);
        expect(result?.bbpSeed.map((p) => p.t)).toEqual([0, 10]);
        expect(drop()).toBeNull();
        useRoastingStore.getState().prepareBean('next');
        expect(useRoastingStore.getState().completed?.snapshot.selection.beanId).toBe('bean-a');
    });

    it('restores the pre-Drop clock, selection, curve and Replay request without including waiting time', () => {
        charge();
        const sessionId = useRoastingStore.getState().sessionId;
        drop();
        vi.advanceTimersByTime(120_000);
        const restored = useRoastingStore.getState().cancelDrop();
        const state = useRoastingStore.getState();
        expect(restored?.replayActive).toBe(true);
        expect(state).toMatchObject({
            sessionId,
            sessionOwnerId: 'owner',
            phase: 'roasting',
            elapsed: 600,
            roastStartMs: Date.now() - 600_000,
            heatHoldAfterDrop: false,
            awaitingNextCharge: false,
            completed: null,
        });
        expect(state.activeSelection?.profileId).toBe('profile-a');
        expect(state.logState.entries.some((entry) => entry.event === 'Drop')).toBe(false);
        expect(state.livePoints.map((p) => p.time)).toEqual([0, 600]);
        vi.advanceTimersByTime(3_000);
        state.tick();
        expect(useRoastingStore.getState().elapsed).toBe(603);
        expect(drop()).not.toBeNull();
    });

    it('next Charge locks A cancellation while retaining its completed summary', () => {
        charge();
        const result = drop();
        const nextId = useRoastingStore.getState().startCharge(undefined, 'owner');
        expect(selectDropCancelable(useRoastingStore.getState())).toBe(false);
        expect(useRoastingStore.getState().completed?.restore).toBeNull();
        expect(useRoastingStore.getState().completed?.summary?.sessionId).toBe(result?.sessionId);
        expect(useRoastingStore.getState().cancelDrop()).toBeNull();
        expect(useRoastingStore.getState().sessionId).toBe(nextId);
    });

    it('discardSummary accepts workspace owner when snapshot sessionOwnerId is still null', () => {
        charge();
        const dropped = drop();
        const sessionId = dropped?.sessionId ?? null;
        useRoastingStore.setState({
            completed: {
                ...useRoastingStore.getState().completed!,
                snapshot: {
                    ...useRoastingStore.getState().completed!.snapshot,
                    sessionOwnerId: null,
                },
            },
        });
        expect(useRoastingStore.getState().discardSummary('owner', sessionId)).toBe(true);
        expect(useRoastingStore.getState().completed?.summary).toBeNull();
    });

    it('discardSummary rejects a mismatched owner when snapshot owner is set', () => {
        charge();
        const dropped = drop();
        expect(useRoastingStore.getState().discardSummary('other-owner', dropped?.sessionId ?? null)).toBe(false);
        expect(useRoastingStore.getState().completed?.summary).not.toBeNull();
    });

    it('late A save cannot clear B summary or unlock another owner', () => {
        charge();
        const a = drop();
        useRoastingStore.getState().startCharge(undefined, 'owner');
        const b = drop();
        expect(useRoastingStore.getState().cancelDrop(a?.sessionId)).toBeNull();
        expect(useRoastingStore.getState().saveSucceeded('owner', a?.sessionId ?? null)).toBe(false);
        expect(useRoastingStore.getState().saveSucceeded('other-owner', b?.sessionId ?? null)).toBe(false);
        expect(useRoastingStore.getState().completed?.summary?.sessionId).toBe(b?.sessionId);
        expect(selectDropCancelable(useRoastingStore.getState())).toBe(true);
        expect(useRoastingStore.getState().saveSucceeded('owner', b?.sessionId ?? null)).toBe(true);
        expect(selectDropCancelable(useRoastingStore.getState())).toBe(false);
        expect(useRoastingStore.getState().completed?.summary).toBeNull();
    });

    it('abnormal End freezes selection and logs, starts Charge wait and has no Drop restore', () => {
        charge();
        const summary = useRoastingStore.getState().abortRoast(200, 'C');
        expect(summary).toMatchObject({ elapsedSec: 600, selectedBeanId: 'bean-a' });
        expect(summary.logEntries[summary.logEntries.length - 1]?.event).toBe('End');
        expect(useRoastingStore.getState()).toMatchObject({
            phase: 'standby',
            sessionId: null,
            heatHoldAfterDrop: true,
            awaitingNextCharge: true,
        });
        expect(selectDropCancelable(useRoastingStore.getState())).toBe(false);
    });
});
