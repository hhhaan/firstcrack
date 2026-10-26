// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRoastSourceCandidates } from './useRoastSourceCandidates';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const queries = vi.hoisted(() => ({
    beansPending: false,
    blendsPending: false,
    profilesPending: false,
    historyPending: false,
    beans: [{ id: 'b1', name: 'Single' }],
    blends: [{ id: 'x1', name: 'Modern' }],
    profiles: [
        {
            id: 'p1',
            default_bean_id: null,
            default_blend_id: null,
            sources: [
                { bean_id: 'b1', blend_id: null },
                { bean_id: null, blend_id: 'x1' },
            ],
        },
    ],
    history: [] as { bean_id: string | null; blend_id: string | null }[],
}));

vi.mock('@entities/bean/queries', () => ({
    useBeans: () => ({ data: queries.beans, isPending: queries.beansPending }),
}));
vi.mock('@entities/blend', () => ({
    useBlends: () => ({ data: queries.blends, isPending: queries.blendsPending }),
}));
vi.mock('@entities/roast-profile', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@entities/roast-profile')>()),
    useRoastProfiles: () => ({ data: queries.profiles, isPending: queries.profilesPending }),
    useProfileSourceHistory: () => ({ data: queries.history, isPending: queries.historyPending }),
}));

const mount = (ownerId: string, profileId: string | null) => {
    const root = createRoot(document.createElement('div'));
    let api: ReturnType<typeof useRoastSourceCandidates> | undefined;
    const Probe = () => {
        api = useRoastSourceCandidates(ownerId, profileId);
        return null;
    };
    act(() => root.render(createElement(Probe)));
    return {
        get api() {
            if (!api) throw new Error('Hook not mounted');
            return api;
        },
        unmount() {
            act(() => root.unmount());
        },
    };
};

describe('useRoastSourceCandidates', () => {
    afterEach(() => {
        queries.beansPending = false;
        queries.blendsPending = false;
        queries.profilesPending = false;
        queries.historyPending = false;
        queries.beans = [{ id: 'b1', name: 'Single' }];
        queries.blends = [{ id: 'x1', name: 'Modern' }];
        queries.history = [];
    });

    it('waits while a lookup is still loading', () => {
        queries.historyPending = true;
        const h = mount('owner', 'p1');
        expect(h.api.ready).toBe(false);
        h.unmount();
    });

    it('uses the lists that loaded when one lookup failed', () => {
        queries.beans = [];
        const h = mount('owner', 'p1');
        expect(h.api.ready).toBe(true);
        expect(h.api.candidates).toEqual([{ beanId: null, blendId: 'x1', name: 'Modern' }]);
        h.unmount();
    });

    it('does not wait when the owner is missing', () => {
        queries.beansPending = true;
        queries.blendsPending = true;
        queries.profilesPending = true;
        queries.historyPending = true;
        const h = mount('', 'p1');
        expect(h.api.ready).toBe(true);
        h.unmount();
    });
});
