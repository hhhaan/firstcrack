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

const session = vi.hoisted(() => ({
    planBatchHandoff: null as null | {
        beanId: string | null;
        beanName: string;
        profileId: string | null;
    },
}));

vi.mock('@shared/store/roastSession', () => ({
    useRoastSessionStore: (sel: (s: { planBatchHandoff: typeof session.planBatchHandoff }) => unknown) =>
        sel({ planBatchHandoff: session.planBatchHandoff }),
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
        session.planBatchHandoff = null;
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

const baseSelection = {
    isActive: true,
    charged: false,
    userProfile: { default_roast_profile_id: 'prof-1' as string | null },
    beans: [] as { id: string }[],
    beansReady: true,
    selectionEpoch: 'ws-a:pre',
};

describe('useRoastProfileSelection Replay profile confirm (#529 D)', () => {
    beforeEach(() => {
        localStorage.clear();
        roastingState.pendingProfileId = null;
        session.planBatchHandoff = null;
        vi.useRealTimers();
    });

    it('같은 프로파일 재선택은 no-op 이고 확인을 열지 않는다', async () => {
        const confirm = vi.fn(async () => true);
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: { default_roast_profile_id: 'prof-1' },
            beans: [],
            beansReady: true,
            confirmTargetChange: confirm,
        });
        expect(h.api.targetProfileId).toBe('prof-1');
        await act(async () => {
            h.api.setUserSelectedTarget('prof-1');
        });
        expect(h.api.targetProfileId).toBe('prof-1');
        expect(confirm).not.toHaveBeenCalled();
        h.unmount();
    });

    it('확인 거절이면 타겟을 유지한다', async () => {
        const confirm = vi.fn(async () => false);
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: { default_roast_profile_id: 'prof-1' },
            beans: [],
            beansReady: true,
            confirmTargetChange: confirm,
        });
        await act(async () => {
            h.api.setUserSelectedTarget('prof-2');
        });
        expect(confirm).toHaveBeenCalledWith('prof-2');
        expect(h.api.targetProfileId).toBe('prof-1');
        h.unmount();
    });

    it('확인하면 타겟을 바꾸고, 해제(null)도 계획 변경으로 취급한다', async () => {
        const confirm = vi.fn(async () => true);
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: { default_roast_profile_id: 'prof-1' },
            beans: [],
            beansReady: true,
            confirmTargetChange: confirm,
        });
        await act(async () => {
            h.api.setUserSelectedTarget(null);
        });
        expect(confirm).toHaveBeenCalledWith(null);
        expect(h.api.targetProfileId).toBeNull();
        h.unmount();
    });
});

describe('useRoastProfileSelection user default save (#554)', () => {
    beforeEach(() => {
        localStorage.clear();
        roastingState.pendingProfileId = null;
        session.planBatchHandoff = null;
        vi.useFakeTimers();
    });

    it('pre-charge cancel keeps the target and does not save a default after the debounce', async () => {
        const saveDefaultProfile = vi.fn();
        const commitApprovedTarget = vi.fn();
        const confirm = vi.fn(async () => false);
        const h = mountHook({
            ...baseSelection,
            confirmTargetChange: confirm,
            commitApprovedTarget,
            saveDefaultProfile,
        });
        await act(async () => {
            h.api.setUserSelectedTarget('prof-2');
        });
        await act(async () => {
            vi.advanceTimersByTime(300);
        });
        expect(h.api.targetProfileId).toBe('prof-1');
        expect(commitApprovedTarget).not.toHaveBeenCalled();
        expect(saveDefaultProfile).not.toHaveBeenCalled();
        h.unmount();
    });

    it('approved pre-charge change stops replay before the target updates, then saves that default', async () => {
        const saveDefaultProfile = vi.fn();
        let targetDuringCommit: string | null = 'missing';
        const h = mountHook({
            ...baseSelection,
            confirmTargetChange: async () => true,
            saveDefaultProfile,
            commitApprovedTarget: () => {
                targetDuringCommit = h.api.targetProfileId;
            },
        });
        await act(async () => {
            h.api.setUserSelectedTarget('prof-2');
        });
        expect(targetDuringCommit).toBe('prof-1');
        expect(h.api.targetProfileId).toBe('prof-2');
        expect(saveDefaultProfile).not.toHaveBeenCalled();
        await act(async () => {
            vi.advanceTimersByTime(299);
        });
        expect(saveDefaultProfile).not.toHaveBeenCalled();
        await act(async () => {
            vi.advanceTimersByTime(1);
        });
        expect(saveDefaultProfile).toHaveBeenCalledTimes(1);
        expect(saveDefaultProfile).toHaveBeenCalledWith('prof-2');
        h.unmount();
    });

    it('after Charge an approved change is session-only', async () => {
        const saveDefaultProfile = vi.fn();
        const h = mountHook({ ...baseSelection, saveDefaultProfile });
        h.rerender({ ...baseSelection, charged: true, saveDefaultProfile });
        await act(async () => {
            h.api.setUserSelectedTarget('prof-2');
        });
        await act(async () => {
            vi.advanceTimersByTime(300);
        });
        expect(h.api.targetProfileId).toBe('prof-2');
        expect(saveDefaultProfile).not.toHaveBeenCalled();
        h.unmount();
    });

    it('null clear is a planned change and saves a null default', async () => {
        const saveDefaultProfile = vi.fn();
        const confirm = vi.fn(async () => true);
        const h = mountHook({ ...baseSelection, confirmTargetChange: confirm, saveDefaultProfile });
        await act(async () => {
            h.api.setUserSelectedTarget(null);
        });
        await act(async () => {
            vi.advanceTimersByTime(300);
        });
        expect(confirm).toHaveBeenCalledWith(null);
        expect(h.api.targetProfileId).toBeNull();
        expect(saveDefaultProfile).toHaveBeenCalledWith(null);
        h.unmount();
    });

    it('rapid selects save only the last approved id', async () => {
        const saveDefaultProfile = vi.fn();
        const h = mountHook({ ...baseSelection, saveDefaultProfile });
        await act(async () => {
            h.api.setUserSelectedTarget('prof-2');
            h.api.setUserSelectedTarget('prof-3');
        });
        await act(async () => {
            vi.advanceTimersByTime(300);
        });
        expect(h.api.targetProfileId).toBe('prof-3');
        expect(saveDefaultProfile).toHaveBeenCalledTimes(1);
        expect(saveDefaultProfile).toHaveBeenCalledWith('prof-3');
        h.unmount();
    });

    it('a late confirm does not apply or save after the batch epoch moves on', async () => {
        let resolveConfirm: (ok: boolean) => void = () => {};
        const saveDefaultProfile = vi.fn();
        const commitApprovedTarget = vi.fn();
        const h = mountHook({
            ...baseSelection,
            confirmTargetChange: () =>
                new Promise<boolean>((resolve) => {
                    resolveConfirm = resolve;
                }),
            commitApprovedTarget,
            saveDefaultProfile,
        });
        act(() => {
            h.api.setUserSelectedTarget('prof-2');
        });
        h.rerender({ ...baseSelection, selectionEpoch: 'ws-a:batch-b', saveDefaultProfile, commitApprovedTarget });
        await act(async () => {
            resolveConfirm(true);
        });
        await act(async () => {
            vi.advanceTimersByTime(300);
        });
        expect(h.api.targetProfileId).toBe('prof-1');
        expect(commitApprovedTarget).not.toHaveBeenCalled();
        expect(saveDefaultProfile).not.toHaveBeenCalled();
        h.unmount();
    });

    it('an approved save still pending does not write after workspace or batch changes', async () => {
        const saveDefaultProfile = vi.fn();
        const h = mountHook({ ...baseSelection, saveDefaultProfile });
        await act(async () => {
            h.api.setUserSelectedTarget('prof-2');
        });
        h.rerender({ ...baseSelection, selectionEpoch: 'ws-b:pre', saveDefaultProfile });
        await act(async () => {
            vi.advanceTimersByTime(300);
        });
        expect(h.api.targetProfileId).toBe('prof-2');
        expect(saveDefaultProfile).not.toHaveBeenCalled();
        h.unmount();
    });

    it('a superseded confirm cannot overwrite a newer selection', async () => {
        const resolvers: ((ok: boolean) => void)[] = [];
        const saveDefaultProfile = vi.fn();
        const h = mountHook({
            ...baseSelection,
            saveDefaultProfile,
            confirmTargetChange: () =>
                new Promise<boolean>((resolve) => {
                    resolvers.push(resolve);
                }),
        });
        act(() => {
            h.api.setUserSelectedTarget('prof-2');
        });
        act(() => {
            h.api.setUserSelectedTarget('prof-3');
        });
        await act(async () => {
            resolvers[0]?.(true);
        });
        expect(h.api.targetProfileId).toBe('prof-1');
        await act(async () => {
            resolvers[1]?.(true);
        });
        expect(h.api.targetProfileId).toBe('prof-3');
        await act(async () => {
            vi.advanceTimersByTime(300);
        });
        expect(saveDefaultProfile).toHaveBeenCalledTimes(1);
        expect(saveDefaultProfile).toHaveBeenCalledWith('prof-3');
        h.unmount();
    });

    it('same-value reselect does not confirm or save', async () => {
        const saveDefaultProfile = vi.fn();
        const confirm = vi.fn(async () => true);
        const h = mountHook({ ...baseSelection, confirmTargetChange: confirm, saveDefaultProfile });
        await act(async () => {
            h.api.setUserSelectedTarget('prof-1');
        });
        await act(async () => {
            vi.advanceTimersByTime(300);
        });
        expect(confirm).not.toHaveBeenCalled();
        expect(saveDefaultProfile).not.toHaveBeenCalled();
        expect(h.api.targetProfileId).toBe('prof-1');
        h.unmount();
    });

    it('pending profile and schedule handoff do not save the account default', async () => {
        const saveDefaultProfile = vi.fn();
        roastingState.pendingProfileId = 'pending-prof';
        const pending = mountHook({
            ...baseSelection,
            userProfile: { default_roast_profile_id: 'prof-1' },
            saveDefaultProfile,
        });
        await act(async () => {
            vi.advanceTimersByTime(300);
        });
        expect(pending.api.targetProfileId).toBe('pending-prof');
        expect(saveDefaultProfile).not.toHaveBeenCalled();
        pending.unmount();

        session.planBatchHandoff = { beanId: 'bean-9', beanName: 'Lot', profileId: 'sched-prof' };
        const handoff = mountHook({
            ...baseSelection,
            userProfile: { default_roast_profile_id: 'prof-1' },
            saveDefaultProfile,
        });
        await act(async () => {
            vi.advanceTimersByTime(300);
        });
        expect(handoff.api.targetProfileId).toBe('sched-prof');
        expect(saveDefaultProfile).not.toHaveBeenCalled();
        handoff.unmount();
    });
});

describe('useRoastProfileSelection stale bean clear (#176)', () => {
    beforeEach(() => {
        localStorage.clear();
        roastingState.pendingProfileId = null;
        session.planBatchHandoff = null;
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
