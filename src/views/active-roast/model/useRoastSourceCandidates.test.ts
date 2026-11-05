// @vitest-environment jsdom
import { useRoastingStore } from '@features/active-roast/model/status';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoastProfileSelection } from './useRoastProfileSelection';
import { useRoastSourceCandidates } from './useRoastSourceCandidates';

const queries = vi.hoisted(() => ({
    beans: {
        data: [
            { id: 'b', name: 'Registered' },
            { id: 'c', name: 'Historical' },
        ],
        isSuccess: true,
    },
    blends: { data: [], isSuccess: true },
    profiles: { data: [{ id: 'B', default_bean_id: 'b', default_blend_id: null }], isSuccess: true },
    history: { data: [{ bean_id: 'c', blend_id: null }], isSuccess: true },
}));
vi.mock('@entities/bean/queries', () => ({ useBeans: () => queries.beans }));
vi.mock('@entities/blend', () => ({ useBlends: () => queries.blends }));
vi.mock('@entities/roast-profile', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@entities/roast-profile')>()),
    useRoastProfiles: () => queries.profiles,
    useProfileSourceHistory: () => queries.history,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('registered source query readiness', () => {
    beforeEach(() => {
        useRoastingStore.getState().reset();
        queries.beans.isSuccess = true;
        queries.blends.isSuccess = true;
        queries.profiles.isSuccess = true;
        queries.history.isSuccess = true;
    });
    afterEach(() => useRoastingStore.getState().reset());

    const mount = () => {
        const root = createRoot(document.createElement('div'));
        let options: ReturnType<typeof useRoastSourceCandidates>;
        let selection: ReturnType<typeof useRoastProfileSelection>;
        const Probe = () => {
            const profileId = useRoastingStore((s) => s.prepared.profileId);
            options = useRoastSourceCandidates('workspace', profileId);
            selection = useRoastProfileSelection({
                isActive: true,
                charged: false,
                userProfile: null,
                workspaceOwnerId: 'workspace',
                registeredSources: options.registeredSources,
            });
            return null;
        };
        const render = () => {
            act(() => root.render(createElement(Probe)));
        };
        render();
        return {
            get options() {
                return options;
            },
            get selection() {
                return selection;
            },
            render,
            unmount: () => {
                act(() => root.unmount());
            },
        };
    };

    it.each([true, false])(
        'applies only the registered default while history success is %s',
        async (historySuccess) => {
            queries.history.isSuccess = historySuccess;
            const h = mount();
            act(() => h.selection.setSelectedBeanId('a'));
            await act(async () => {
                await h.selection.setUserSelectedTarget('B');
            });
            expect(h.selection.selectedBeanId).toBe('b');
            expect(h.selection.handoffBeanName).toBe('Registered');
            expect(h.options.candidates.map((c) => c.beanId)).toEqual(['b', 'c']);
            expect(h.options.registeredSources.ready).toBe(true);
            expect(h.options.ready).toBe(historySuccess);
            h.unmount();
        },
    );
    it.each(['beans', 'blends', 'profiles'] as const)(
        'does not treat failed or loading %s as a successful empty result',
        async (query) => {
            queries[query].isSuccess = false;
            const h = mount();
            act(() => h.selection.setSelectedBeanId('a', 'Current'));
            await act(async () => {
                await h.selection.setUserSelectedTarget('B');
            });
            expect(h.options.registeredSources.ready).toBe(false);
            expect(h.selection.selectedBeanId).toBe('a');
            expect(useRoastingStore.getState().prepared.profileSourceRequest).toBeTruthy();
            queries[query].isSuccess = true;
            h.render();
            expect(h.selection.selectedBeanId).toBe('b');
            h.unmount();
        },
    );
});
