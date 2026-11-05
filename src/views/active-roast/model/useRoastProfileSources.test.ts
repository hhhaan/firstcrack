// @vitest-environment jsdom
import { useRoastingStore } from '@features/active-roast/model/status';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useRoastProfileSelection } from './useRoastProfileSelection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HookApi = ReturnType<typeof useRoastProfileSelection>;

function mountHook(props: Parameters<typeof useRoastProfileSelection>[0], strict = false) {
    const root = createRoot(document.createElement('div'));
    let api: HookApi | undefined;
    const Probe = () => {
        api = useRoastProfileSelection(props);
        return null;
    };
    void act(() => root.render(strict ? createElement(StrictMode, null, createElement(Probe)) : createElement(Probe)));
    return {
        get api() {
            if (!api) throw new Error('Hook not mounted');
            return api;
        },
        rerender(next: Parameters<typeof useRoastProfileSelection>[0]) {
            props = next;
            void act(() =>
                root.render(strict ? createElement(StrictMode, null, createElement(Probe)) : createElement(Probe)),
            );
        },
        unmount() {
            void act(() => root.unmount());
        },
    };
}

describe('profile inventory candidates', () => {
    afterEach(() => {
        useRoastingStore.getState().reset();
        localStorage.clear();
    });
    it.each([
        { beanId: 'b1', blendId: null, name: 'Single' },
        { beanId: null, blendId: 'x1', name: 'Modern' },
    ])('starts the same profile with its chosen source over a previous manual choice: $name', async (source) => {
        const store = useRoastingStore.getState();
        store.reset();
        store.commitProfile('p1', null, null);
        store.prepareBean('previous');
        store.setPendingProfile('p1', source);
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: { default_roast_profile_id: 'p1' },
            registeredSources: { profileId: 'p1', workspaceOwnerId: null, ready: true, candidates: [source] },
        });
        await act(async () => {});
        expect(h.api.targetProfileId).toBe('p1');
        expect(h.api.selectedBeanId).toBe(source.beanId);
        expect(h.api.selectedBlendId).toBe(source.blendId);
        expect(h.api.handoffBeanName).toBe(source.name);
        expect(useRoastingStore.getState().pendingProfileSource).toBeNull();
        h.unmount();
    });
    it('keeps a profile and its source queued while a batch is running', () => {
        const store = useRoastingStore.getState();
        store.reset();
        store.prepareBean('running');
        store.startCharge();
        const source = { beanId: null, blendId: 'next-blend', name: 'Next' };
        store.setPendingProfile('next-profile', source);
        const h = mountHook({ isActive: true, charged: true, userProfile: null });
        expect(h.api.selectedBeanId).toBe('running');
        expect(h.api.selectedBlendId).toBeNull();
        expect(useRoastingStore.getState().pendingProfileSource).toEqual(source);
        h.unmount();
    });
    it('keeps the previous source when the profile change is rejected', async () => {
        const store = useRoastingStore.getState();
        store.reset();
        store.prepareBean('previous');
        store.setPendingProfile('next-profile', { beanId: null, blendId: 'next-blend', name: 'Next' });
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: null,
            confirmTargetChange: async () => false,
        });
        await act(async () => {});
        expect(h.api.selectedBeanId).toBe('previous');
        expect(h.api.selectedBlendId).toBeNull();
        expect(useRoastingStore.getState().pendingProfileSource).toBeNull();
        h.unmount();
    });
    const single = { beanId: 'b', blendId: null, name: 'Registered B' };
    const blend = { beanId: null, blendId: 'blend', name: 'Registered Blend' };
    const sources = (
        profileId: string | null,
        candidates = [single],
        ready = true,
        workspaceOwnerId: string | null = null,
    ) => ({
        profileId,
        candidates,
        ready,
        workspaceOwnerId,
    });
    const base = { isActive: true, charged: false, userProfile: null };

    it('replaces a previous manual source once for each explicit new Target', async () => {
        useRoastingStore.getState().prepareBean('a', 'Previous');
        const h = mountHook({ ...base, registeredSources: sources('B') }, true);
        await act(async () => {
            await h.api.setUserSelectedTarget('B');
        });
        expect(h.api.selectedBeanId).toBe('b');
        expect(h.api.handoffBeanName).toBe('Registered B');
        act(() => h.api.setSelectedBeanId('c', 'Manual'));
        h.rerender({ ...base, registeredSources: sources('B', [blend]) });
        await act(async () => {
            await h.api.setUserSelectedTarget('B');
        });
        expect(h.api.selectedBeanId).toBe('c');
        h.rerender({ ...base, registeredSources: sources('C', [blend]) });
        await act(async () => {
            await h.api.setUserSelectedTarget('C');
        });
        expect(h.api.selectedBlendId).toBe('blend');
        expect(h.api.handoffBeanName).toBe('Registered Blend');
        h.unmount();
    });
    it('consumes a delayed default when a user chooses a source before it arrives', async () => {
        const h = mountHook({ ...base, registeredSources: sources('B', [], false) });
        await act(async () => {
            await h.api.setUserSelectedTarget('B');
        });
        act(() => h.api.setSelectedBeanId('c', 'Manual'));
        h.rerender({ ...base, registeredSources: sources('B') });
        expect(h.api.selectedBeanId).toBe('c');
        h.unmount();
    });
    it('ignores stale results across fast Target changes, including B → C → B', async () => {
        const h = mountHook({ ...base, registeredSources: sources('B', [], false) });
        await act(async () => {
            await h.api.setUserSelectedTarget('B');
        });
        const oldRequest = useRoastingStore.getState().prepared.profileSourceRequest;
        await act(async () => {
            await h.api.setUserSelectedTarget('C');
        });
        h.rerender({ ...base, registeredSources: sources('B') });
        expect(h.api.selectedBeanId).toBeNull();
        h.rerender({ ...base, registeredSources: sources('C', [blend]) });
        expect(h.api.selectedBlendId).toBe('blend');
        h.rerender({ ...base, registeredSources: sources('B', [], false) });
        await act(async () => {
            await h.api.setUserSelectedTarget('B');
        });
        act(() => useRoastingStore.getState().applyProfileSource(single, false, oldRequest));
        expect(h.api.selectedBlendId).toBe('blend');
        h.rerender({ ...base, registeredSources: sources('B') });
        expect(h.api.selectedBeanId).toBe('b');
        h.unmount();
    });
    it('clears for multiple registrations, preserves for none and Target removal, and consumes empty results', async () => {
        useRoastingStore.getState().prepareBean('a', 'Previous');
        const h = mountHook({ ...base, registeredSources: sources('B', [], false) });
        await act(async () => {
            await h.api.setUserSelectedTarget('B');
        });
        expect(h.api.selectedBeanId).toBe('a');
        h.rerender({ ...base, registeredSources: sources('B', [single, blend]) });
        expect(h.api.selectedBeanId).toBeNull();
        act(() => h.api.setSelectedBeanId('c'));
        h.rerender({ ...base, registeredSources: sources('C', []) });
        await act(async () => {
            await h.api.setUserSelectedTarget('C');
        });
        expect(h.api.selectedBeanId).toBe('c');
        h.rerender({ ...base, registeredSources: sources('C', [single]) });
        expect(h.api.selectedBeanId).toBe('c');
        await act(async () => {
            await h.api.setUserSelectedTarget(null);
        });
        expect(h.api.selectedBeanId).toBe('c');
        h.unmount();
    });
    it('preserves restored selection on mount rather than granting another automatic default', () => {
        const store = useRoastingStore.getState();
        store.initializeProfile('B');
        store.prepareBean('restored', 'Restored');
        const h = mountHook({ ...base, registeredSources: sources('B') });
        expect(h.api.selectedBeanId).toBe('restored');
        h.unmount();
    });
    it('preserves source and Target when Replay rejects a new Target', async () => {
        useRoastingStore.getState().prepareBean('a');
        const h = mountHook({ ...base, registeredSources: sources('B'), confirmTargetChange: async () => false });
        await act(async () => {
            await h.api.setUserSelectedTarget('B');
        });
        expect(h.api.targetProfileId).toBeNull();
        expect(h.api.selectedBeanId).toBe('a');
        expect(useRoastingStore.getState().prepared.profileSourceRequest).toBeNull();
        h.unmount();
    });
    it('invalidates pending defaults at Charge and preserves the source through the completed snapshot', async () => {
        useRoastingStore.getState().prepareBean('a', 'Charged A');
        const h = mountHook({ ...base, registeredSources: sources('B', [], false) });
        await act(async () => {
            await h.api.setUserSelectedTarget('B');
        });
        act(() => {
            useRoastingStore.getState().startCharge();
        });
        h.rerender({ ...base, registeredSources: sources('B') });
        expect(h.api.selectedBeanId).toBe('a');
        await act(async () => {
            await h.api.setUserSelectedTarget('C');
        });
        h.rerender({ ...base, registeredSources: sources('C', [blend]) });
        expect(h.api.selectedBeanId).toBe('a');
        act(() => {
            useRoastingStore.getState().drop({ rawBT: 200, unit: 'C', replayActive: false });
        });
        expect(useRoastingStore.getState().completed?.snapshot.selection).toMatchObject({
            beanId: 'a',
            beanName: 'Charged A',
        });
        expect(useRoastingStore.getState().completed?.summary).toMatchObject({
            selectedBeanId: 'a',
            handoffBeanName: 'Charged A',
        });
        h.unmount();
    });
    it('freezes the displayed automatic source id and name into the save snapshot', async () => {
        const h = mountHook({ ...base, registeredSources: sources('B', [blend]) });
        await act(async () => {
            await h.api.setUserSelectedTarget('B');
        });
        expect(h.api.selectedBlendId).toBe('blend');
        expect(h.api.handoffBeanName).toBe('Registered Blend');
        act(() => {
            useRoastingStore.getState().startCharge();
        });
        act(() => {
            useRoastingStore.getState().drop({ rawBT: 200, unit: 'C', replayActive: false });
        });
        expect(useRoastingStore.getState().completed?.snapshot.selection).toMatchObject({
            beanId: null,
            blendId: 'blend',
            beanName: 'Registered Blend',
        });
        expect(useRoastingStore.getState().completed?.summary).toMatchObject({
            selectedBeanId: null,
            selectedBlendId: 'blend',
            handoffBeanName: 'Registered Blend',
        });
        h.rerender({ ...base, registeredSources: sources('B') });
        expect(useRoastingStore.getState().completed?.snapshot.selection.blendId).toBe('blend');
        h.unmount();
    });
    it('invalidates pending defaults on workspace switch and plan handoff', async () => {
        const h = mountHook({ ...base, workspaceOwnerId: 'one', registeredSources: sources('B', [], false, 'one') });
        await act(async () => {
            await h.api.setUserSelectedTarget('B');
        });
        const oldRequest = useRoastingStore.getState().prepared.profileSourceRequest;
        h.rerender({ ...base, workspaceOwnerId: 'two', registeredSources: sources('B', [single], true, 'one') });
        act(() => useRoastingStore.getState().applyProfileSource(single, false, oldRequest));
        expect(h.api.selectedBeanId).toBeNull();
        await act(async () => {
            await h.api.setUserSelectedTarget('B');
        });
        act(() =>
            useRoastingStore.getState().startBatch({
                planBatchId: 'batch',
                planId: 'plan',
                beanId: null,
                blendId: 'scheduled',
                beanName: 'Schedule',
                batchCount: 1,
                completedSessions: 0,
                batchSizeKg: 5,
                profileId: 'B',
            }),
        );
        h.rerender({ ...base, workspaceOwnerId: 'two', registeredSources: sources('B', [single], true, 'two') });
        expect(h.api.selectedBlendId).toBe('scheduled');
        expect(h.api.handoffBeanName).toBe('Schedule');
        h.unmount();
    });
});
