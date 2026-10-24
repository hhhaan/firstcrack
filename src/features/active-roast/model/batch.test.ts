import type { LiveRoastPoint } from '@shared/types/roast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectDropCancelable, selectReviewSnapshot, selectRoastSelection } from './batch';
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

    it('keeps automatic and edited titles in completed and restored snapshots', () => {
        charge();
        const state = useRoastingStore.getState();
        const id = state.sessionId ?? '';
        expect(useRoastingStore.getState().activeSelection?.identity?.title).toBe('Lot A');
        state.setRunningBatchTitle(id, 'Morning production');
        state.setSourceDisplayName({ beanId: 'bean-a', beanName: 'Colombia Santander' }, 'owner');
        drop();
        expect(useRoastingStore.getState().completed?.summary?.batchName).toBe('Morning production');
        state.cancelDrop();
        expect(useRoastingStore.getState().activeSelection?.identity?.title).toBe('Morning production');
    });

    it('fills a late bean display name and restores it when an edited title is cleared', () => {
        const state = useRoastingStore.getState();
        state.prepareWorkspace('owner');
        state.prepareBean('bean-a');
        const id = state.startCharge(undefined, 'owner') ?? '';
        state.setSourceDisplayName({ beanId: 'bean-a', beanName: 'Colombia Santander' }, 'owner');
        expect(useRoastingStore.getState().activeSelection?.identity?.title).toBe('Colombia Santander');
        state.setRunningBatchTitle(id, 'Custom title');
        state.setSourceDisplayName({ beanId: 'bean-a', beanName: 'Colombia Huila' }, 'owner');
        expect(useRoastingStore.getState().activeSelection?.identity?.title).toBe('Custom title');
        state.setRunningBatchTitle(id, '');
        expect(useRoastingStore.getState().activeSelection?.identity?.title).toBe('Colombia Huila');
        drop();
        expect(useRoastingStore.getState().completed?.summary?.batchName).toBe('Colombia Huila');
    });

    it('ignores names from a different source or workspace', () => {
        charge();
        const state = useRoastingStore.getState();
        state.setSourceDisplayName({ beanId: 'bean-b', beanName: 'Other bean' }, 'owner');
        state.setSourceDisplayName({ beanId: 'bean-a', beanName: 'Other workspace' }, 'other');
        state.setSourceDisplayName({ beanId: 'bean-a', blendId: 'blend-a', beanName: 'Other blend' }, 'owner');
        expect(useRoastingStore.getState().activeSelection?.identity?.title).toBe('Lot A');
        expect(useRoastingStore.getState().prepared.beanName).toBe('Lot A');
    });

    it('keeps the blend title when changing the profile before save', () => {
        const state = useRoastingStore.getState();
        state.prepareWorkspace('owner');
        state.prepareBlend('blend-a', 'Modern');
        state.commitProfile('profile-a', null, 'owner');
        const id = state.startCharge(undefined, 'owner') ?? '';
        state.commitProfile('profile-b', id, 'owner');
        expect(useRoastingStore.getState().activeSelection?.identity).toMatchObject({
            title: 'Modern',
        });
    });

    it.each([
        { beanId: 'bean-b', blendId: null, beanName: 'New lot' },
        { beanId: null, blendId: 'blend-b', beanName: 'New blend' },
    ])('corrects the running source without resetting the roast: $beanName', (source) => {
        charge();
        const state = useRoastingStore.getState();
        const id = state.sessionId;
        state.editRunningSource(source, id, 'owner');
        const next = useRoastingStore.getState();
        expect(next.activeSelection).toMatchObject({
            ...source,
            profileId: 'profile-a',
            identity: { title: source.beanName },
        });
        expect(next.sessionId).toBe(id);
        expect(next.roastStartMs).toBe(state.roastStartMs);
        expect(next.livePoints).toBe(state.livePoints);
        expect(next.logState).toBe(state.logState);
        expect(next.prepared).toBe(state.prepared);
        drop();
        expect(useRoastingStore.getState().completed?.snapshot.selection).toMatchObject(source);
        state.cancelDrop();
        expect(useRoastingStore.getState().activeSelection).toMatchObject(source);
    });

    it('keeps an edited title when switching between blends and beans', () => {
        charge();
        const state = useRoastingStore.getState();
        const id = state.sessionId ?? '';
        state.setRunningBatchTitle(id, 'Morning production');
        state.editRunningSource({ beanId: null, blendId: 'blend-b', beanName: 'Blend' }, id, 'owner');
        state.editRunningSource({ beanId: 'bean-b', beanName: 'Bean' }, id, 'owner');
        expect(useRoastingStore.getState().activeSelection).toMatchObject({
            beanId: 'bean-b',
            blendId: null,
            identity: { name: 'Bean', title: 'Morning production', edited: true },
        });
    });

    it('rejects source corrections from stale sessions and other workspaces', () => {
        charge();
        const state = useRoastingStore.getState();
        const source = { beanId: 'bean-b', beanName: 'Other' };
        state.editRunningSource(source, 'stale-session', 'owner');
        state.editRunningSource(source, state.sessionId, 'other-owner');
        state.editRunningSource(source, state.sessionId, null);
        expect(useRoastingStore.getState().activeSelection).toBe(state.activeSelection);
    });

    it('detaches a changed source from its schedule without overwriting the next preparation', () => {
        const state = useRoastingStore.getState();
        state.prepareWorkspace('owner');
        state.startBatch({
            planBatchId: 'batch-a',
            planId: 'plan-a',
            beanId: 'bean-a',
            blendId: null,
            beanName: 'Planned lot',
            profileId: 'profile-a',
            batchSizeKg: 1,
            batchCount: 1,
            completedSessions: 0,
        });
        const id = state.startCharge(undefined, 'owner');
        const prepared = useRoastingStore.getState().prepared;
        state.editRunningSource({ beanId: 'bean-b', beanName: 'Actual lot' }, id, 'owner');
        expect(useRoastingStore.getState().activeSelection?.planBatchHandoff).toBeNull();
        expect(useRoastingStore.getState().prepared).toBe(prepared);
        state.abortRoast(200, 'C');
        expect(useRoastingStore.getState().completed?.summary).toMatchObject({
            selectedBeanId: 'bean-b',
            handoffBeanName: 'Actual lot',
            planBatchHandoff: null,
        });
    });

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

    it('corrects only the running source and preserves it through Drop and Cancel', () => {
        charge();
        const before = useRoastingStore.getState();
        expect(
            before.editRunningSource({ beanId: 'corrected', blendId: null, beanName: null }, before.sessionId, 'other'),
        ).toBe(false);
        expect(before.editRunningSource({ beanId: 'corrected', blendId: null, beanName: null }, 'stale', 'owner')).toBe(
            false,
        );
        expect(
            before.editRunningSource({ beanId: 'corrected', blendId: null, beanName: null }, before.sessionId, 'owner'),
        ).toBe(true);
        const corrected = useRoastingStore.getState();
        expect(corrected.prepared.beanId).toBe('bean-a');
        expect(corrected.sessionId).toBe(before.sessionId);
        expect(corrected.livePoints).toBe(before.livePoints);
        expect(corrected.activeSelection?.beanId).toBe('corrected');
        drop();
        expect(useRoastingStore.getState().completed?.summary?.selectedBeanId).toBe('corrected');
        useRoastingStore.getState().cancelDrop();
        expect(useRoastingStore.getState().activeSelection?.beanId).toBe('corrected');
    });

    it('detaches a corrected scheduled batch while retaining the next preparation', () => {
        const store = useRoastingStore.getState();
        store.prepareWorkspace('owner');
        store.startBatch({
            planBatchId: 'scheduled',
            planId: 'plan',
            beanId: 'planned',
            blendId: null,
            beanName: 'Planned',
            profileId: 'profile-a',
            batchSizeKg: 1,
            batchCount: 1,
            completedSessions: 0,
        });
        store.startCharge(undefined, 'owner');
        const current = useRoastingStore.getState();
        expect(
            current.editRunningSource(
                { beanId: null, blendId: 'corrected-blend', beanName: 'Corrected' },
                current.sessionId,
                'owner',
            ),
        ).toBe(true);
        expect(useRoastingStore.getState().activeSelection).toMatchObject({
            blendId: 'corrected-blend',
            beanId: null,
            planBatchHandoff: null,
        });
        expect(useRoastingStore.getState().prepared.planBatchHandoff?.planBatchId).toBe('scheduled');
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

describe('saved roast review keeps collection independent', () => {
    beforeEach(() => {
        useRoastingStore.getState().reset();
    });
    it('rejects review log updates for another session, owner, or a running next batch', () => {
        charge();
        const result = drop();
        const state = useRoastingStore.getState();
        const id = result?.snapshot.sessionId ?? '';
        state.saveSucceeded('owner', id);
        const before = useRoastingStore.getState().completed;
        state.replaceReviewLog('stale-session', 'owner', []);
        state.replaceReviewLog(id, 'other-owner', []);
        expect(useRoastingStore.getState().completed).toBe(before);
        state.startCharge(undefined, 'owner');
        const next = useRoastingStore.getState().completed;
        state.replaceReviewLog(id, 'owner', []);
        expect(useRoastingStore.getState().completed).toBe(next);
    });
    it('retains Drop and the curve after save; returning only dismisses the review', () => {
        charge();
        const result = drop();
        const state = useRoastingStore.getState();
        const id = result?.snapshot.sessionId ?? null;
        expect(state.saveSucceeded('owner', id)).toBe(true);
        expect(useRoastingStore.getState().reviewSessionId).toBe(id);
        expect(selectReviewSnapshot(useRoastingStore.getState())?.livePoints).toHaveLength(2);
        expect(useRoastingStore.getState().completed?.snapshot.logEntries.some((entry) => entry.event === 'Drop')).toBe(
            true,
        );
        expect(useRoastingStore.getState().completed?.snapshot.livePoints).toHaveLength(2);
        expect(useRoastingStore.getState().awaitingNextCharge).toBe(true);
        expect(selectDropCancelable(useRoastingStore.getState())).toBe(false);
        const entry = result?.snapshot.logEntries[0];
        expect(entry).toBeDefined();
        if (!entry) return;
        state.replaceReviewLog(id ?? '', 'owner', [{ ...entry, note: 'moved' }]);
        expect(selectReviewSnapshot(useRoastingStore.getState())?.logEntries[0]?.note).toBe('moved');
        expect(useRoastingStore.getState().logState.entries).toEqual([]);
        state.dismissCompletedReview();
        expect(useRoastingStore.getState().reviewSessionId).toBeNull();
        expect(selectReviewSnapshot(useRoastingStore.getState())).toBeNull();
        expect(useRoastingStore.getState().completed?.submitted).toBe(true);
        expect(useRoastingStore.getState().awaitingNextCharge).toBe(true);
    });
    it('a next Charge clears the review and late save completion cannot reopen it', () => {
        charge();
        const result = drop();
        const state = useRoastingStore.getState();
        state.saveSucceeded('owner', result?.snapshot.sessionId ?? null);
        const nextId = state.startCharge(undefined, 'owner', { bt: 180, unit: 'C' });
        expect(useRoastingStore.getState().reviewSessionId).toBeNull();
        state.saveSucceeded('owner', result?.snapshot.sessionId ?? null);
        expect(useRoastingStore.getState().reviewSessionId).toBeNull();
        expect(useRoastingStore.getState().sessionId).toBe(nextId);
    });
    it('saving A after B starts preserves B', () => {
        charge();
        const result = drop();
        const state = useRoastingStore.getState();
        const nextId = state.startCharge(undefined, 'owner', { bt: 180, unit: 'C' });
        state.saveSucceeded('owner', result?.snapshot.sessionId ?? null);
        expect(useRoastingStore.getState().reviewSessionId).toBeNull();
        expect(useRoastingStore.getState().sessionId).toBe(nextId);
        expect(useRoastingStore.getState().phase).toBe('roasting');
    });
    it('workspace change dismisses a saved review', () => {
        charge();
        const result = drop();
        useRoastingStore.getState().saveSucceeded('owner', result?.snapshot.sessionId ?? null);
        useRoastingStore.getState().prepareWorkspace('another-owner');
        expect(useRoastingStore.getState().reviewSessionId).toBeNull();
    });
});

describe('ad-hoc blend selection', () => {
    afterEach(() => useRoastingStore.getState().reset());
    it('freezes a blend at Charge, retains it through Drop and Cancel, and protects the running selection', () => {
        const store = useRoastingStore.getState();
        store.reset();
        store.prepareBlend('blend-a', 'Modern');
        store.startCharge(undefined, 'owner', { bt: 180, unit: 'C' });
        store.applyProfileSource({ beanId: 'bean-b', blendId: null, name: 'Other' });
        expect(selectRoastSelection(useRoastingStore.getState())).toMatchObject({
            beanId: null,
            blendId: 'blend-a',
            planBatchHandoff: null,
        });
        store.drop({ rawBT: 200, unit: 'C', replayActive: false });
        expect(useRoastingStore.getState().completed?.snapshot.selection.blendId).toBe('blend-a');
        expect(useRoastingStore.getState().completed?.summary?.selectedBlendId).toBe('blend-a');
        store.cancelDrop();
        expect(selectRoastSelection(useRoastingStore.getState()).blendId).toBe('blend-a');
    });
    it('replaces previous automatic sources while preserving explicit choices', () => {
        const store = useRoastingStore.getState();
        store.reset();
        store.applyProfileSource({ beanId: null, blendId: 'blend-a', name: 'Modern' });
        store.applyProfileSource({ beanId: 'bean-a', blendId: null, name: 'Single' });
        expect(useRoastingStore.getState().prepared.beanId).toBe('bean-a');
        store.applyProfileSource(null);
        expect(useRoastingStore.getState().prepared.beanId).toBeNull();
        store.prepareBean('manual');
        store.applyProfileSource({ beanId: null, blendId: 'blend-b', name: 'Other' });
        expect(useRoastingStore.getState().prepared.beanId).toBe('manual');
    });
});
