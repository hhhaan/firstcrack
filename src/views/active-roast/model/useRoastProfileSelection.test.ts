// @vitest-environment jsdom
import { DEFAULT_BEAN_KEY } from '@features/active-roast/lib/constants';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoastProfileSelection } from './useRoastProfileSelection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roastingState = {
    pendingBeanId: null as string | null,
    pendingBeanName: null as string | null,
    pendingProfileId: null as string | null,
    setPendingBean: vi.fn(),
    setPendingProfile: (id: string | null) => {
        roastingState.pendingProfileId = id;
    },
};

vi.mock('@features/active-roast/model/status', () => ({
    useRoastingStore: {
        getState: () => roastingState,
    },
}));

vi.mock('@shared/store/roastSession', () => ({
    useRoastSessionStore: (sel: (s: { planBatchHandoff: null }) => unknown) => sel({ planBatchHandoff: null }),
}));

type HookApi = ReturnType<typeof useRoastProfileSelection>;

function mountHook(props: Parameters<typeof useRoastProfileSelection>[0]) {
    const root = createRoot(document.createElement('div'));
    let api: HookApi | undefined;
    const Probe = () => {
        api = useRoastProfileSelection(props);
        return null;
    };
    void act(() => root.render(createElement(Probe)));
    return {
        get api() {
            return api!;
        },
        rerender(next: Parameters<typeof useRoastProfileSelection>[0]) {
            props = next;
            void act(() => root.render(createElement(Probe)));
        },
        unmount() {
            void act(() => root.unmount());
        },
    };
}

describe('useRoastProfileSelection pending profile handoff', () => {
    beforeEach(() => {
        localStorage.clear();
        roastingState.pendingProfileId = null;
    });

    it('consumes pendingProfileId on activation and resists default overwrite', () => {
        roastingState.pendingProfileId = 'prof-1';
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: { default_roast_profile_id: 'default-prof' },
            beans: [],
            beansReady: true,
        });
        expect(h.api.targetProfileId).toBe('prof-1');
        expect(roastingState.pendingProfileId).toBeNull();

        h.rerender({
            isActive: true,
            charged: false,
            userProfile: { default_roast_profile_id: 'other-default' },
            beans: [],
            beansReady: true,
        });
        expect(h.api.targetProfileId).toBe('prof-1');
        h.unmount();
    });

    it('no pending id → falls back to default profile', () => {
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: { default_roast_profile_id: 'default-prof' },
            beans: [],
            beansReady: true,
        });
        expect(h.api.targetProfileId).toBe('default-prof');
        h.unmount();
    });
});

describe('useRoastProfileSelection stale bean clear (#176)', () => {
    beforeEach(() => {
        localStorage.clear();
        roastingState.pendingProfileId = null;
        localStorage.setItem(DEFAULT_BEAN_KEY, 'stale-bean');
    });

    it('beansReady + id not in list → clear selectedBeanId and localStorage', () => {
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: null,
            beans: [{ id: 'other' }],
            beansReady: true,
        });
        expect(h.api.selectedBeanId).toBeNull();
        expect(localStorage.getItem(DEFAULT_BEAN_KEY)).toBeNull();
        h.unmount();
    });

    it('loading (beansReady false) → do not clear stale id', () => {
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: null,
            beans: [],
            beansReady: false,
        });
        expect(h.api.selectedBeanId).toBe('stale-bean');
        expect(localStorage.getItem(DEFAULT_BEAN_KEY)).toBe('stale-bean');
        h.unmount();
    });

    it('id present in beans list → keep selection', () => {
        localStorage.setItem(DEFAULT_BEAN_KEY, 'bean-1');
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: null,
            beans: [{ id: 'bean-1' }],
            beansReady: true,
        });
        expect(h.api.selectedBeanId).toBe('bean-1');
        h.unmount();
    });
});
