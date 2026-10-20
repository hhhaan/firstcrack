// @vitest-environment jsdom
import { useRoastingStore } from '@features/active-roast/model/status';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
            sourceCandidatesReady: true,
            sourceCandidates: [{ beanId: 'historical', blendId: null, name: 'Historical' }, source],
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
    it('replaces a deleted local default when a sole profile candidate arrives', () => {
        const store = useRoastingStore.getState();
        store.reset();
        localStorage.setItem('fc_default_bean_id', 'deleted');
        const props = {
            isActive: true,
            charged: false,
            userProfile: null,
            beansReady: true,
            beans: [],
            sourceCandidatesReady: false,
        };
        const h = mountHook(props);
        h.rerender({
            ...props,
            sourceCandidatesReady: true,
            sourceCandidates: [{ beanId: null, blendId: 'x1', name: 'Modern' }],
        });
        expect(h.api.selectedBlendId).toBe('x1');
        h.unmount();
    });
    it('requires an explicit choice among several candidates instead of reusing a local default', () => {
        const store = useRoastingStore.getState();
        store.reset();
        store.initializeBean('default-bean');
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: null,
            sourceCandidatesReady: true,
            sourceCandidates: [
                { beanId: 'b1', blendId: null, name: 'Single' },
                { beanId: null, blendId: 'x1', name: 'Modern' },
            ],
        });
        expect(h.api.selectedBeanId).toBeNull();
        expect(h.api.selectedBlendId).toBeNull();
        h.unmount();
    });
    it('preserves the scheduled source when a profile has another sole candidate', () => {
        const store = useRoastingStore.getState();
        store.reset();
        store.startBatch({
            planBatchId: 'batch',
            planId: 'plan',
            beanId: null,
            blendId: 'scheduled',
            beanName: 'Schedule',
            batchCount: 1,
            completedSessions: 0,
            batchSizeKg: 5,
            profileId: null,
        });
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: null,
            sourceCandidatesReady: true,
            sourceCandidates: [{ beanId: 'b1', blendId: null, name: 'Single' }],
        });
        expect(h.api.selectedBlendId).toBe('scheduled');
        h.unmount();
    });
    it('automatically selects a sole blend after candidates load and keeps manual overrides', async () => {
        vi.useRealTimers();
        useRoastingStore.getState().reset();
        const props = {
            isActive: true,
            charged: false,
            userProfile: { default_roast_profile_id: 'p1' },
            sourceCandidatesReady: false,
        };
        const h = mountHook(props);
        await act(async () => {});
        expect(h.api.selectedBlendId).toBeNull();
        const loaded = {
            ...props,
            sourceCandidatesReady: true,
            sourceCandidates: [{ beanId: null, blendId: 'x1', name: 'Modern' }],
        };
        h.rerender(loaded);
        expect(h.api.selectedBlendId).toBe('x1');
        act(() => h.api.setSelectedBeanId('manual'));
        h.rerender({ ...loaded, sourceCandidates: [{ beanId: null, blendId: 'x2', name: 'Other' }] });
        expect(h.api.selectedBeanId).toBe('manual');
        expect(h.api.selectedBlendId).toBeNull();
        h.unmount();
    });
    it('clears a previous automatic pick for multiple candidates without changing the running batch', async () => {
        vi.useRealTimers();
        useRoastingStore.getState().reset();
        const a = { beanId: 'b1', blendId: null, name: 'Single' };
        const b = { beanId: null, blendId: 'x1', name: 'Modern' };
        const props = {
            isActive: true,
            charged: false,
            userProfile: { default_roast_profile_id: 'p1' },
            sourceCandidatesReady: true,
            sourceCandidates: [a],
        };
        const h = mountHook(props);
        await act(async () => {});
        expect(h.api.selectedBeanId).toBe('b1');
        h.rerender({ ...props, sourceCandidates: [a, b] });
        expect(h.api.selectedBeanId).toBeNull();
        h.rerender({ ...props, sourceCandidates: [b] });
        act(() => {
            useRoastingStore.getState().startCharge();
        });
        h.rerender({ ...props, charged: true });
        expect(h.api.selectedBlendId).toBe('x1');
        h.unmount();
    });
});
