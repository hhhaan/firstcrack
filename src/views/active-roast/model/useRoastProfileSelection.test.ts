// @vitest-environment jsdom
import { DEFAULT_BEAN_KEY } from '@features/active-roast/lib/constants';
import { useRoastingStore } from '@features/active-roast/model/status';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
            return api!;
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

describe('useRoastProfileSelection pending profile handoff', () => {
    beforeEach(() => {
        localStorage.clear();
        useRoastingStore.getState().reset();
        useRoastingStore.getState().completeBatch();
    });

    it('consumes pendingProfileId on activation and resists default overwrite', async () => {
        useRoastingStore.getState().setPendingProfile('prof-1');
        const h = mountHook({
            isActive: true,
            charged: false,
            userProfile: { default_roast_profile_id: 'default-prof' },
            beans: [],
            beansReady: true,
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(h.api.targetProfileId).toBe('prof-1');
        expect(useRoastingStore.getState().pendingProfileId).toBeNull();

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
        useRoastingStore.getState().reset();
        useRoastingStore.getState().completeBatch();
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
        useRoastingStore.getState().reset();
        useRoastingStore.getState().completeBatch();
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
        useRoastingStore.getState().setPendingProfile('pending-prof');
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

        useRoastingStore.getState().startBatch({
            planBatchId: 'batch-9',
            planId: 'plan-9',
            beanId: 'bean-9',
            blendId: null,
            beanName: 'Lot',
            profileId: 'sched-prof',
            batchSizeKg: 1,
            batchCount: 1,
            completedSessions: 0,
        });
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
        useRoastingStore.getState().reset();
        useRoastingStore.getState().completeBatch();
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

describe('selection ownership across screen recovery', () => {
    beforeEach(() => {
        localStorage.clear();
        useRoastingStore.getState().reset();
        vi.useRealTimers();
    });
    it('applies explicit bean and blend choices to the running batch', () => {
        const h = mountHook({ ...baseSelection, workspaceOwnerId: 'ws-a' });
        act(() => useRoastingStore.getState().startCharge(undefined, 'ws-a'));
        h.rerender({ ...baseSelection, workspaceOwnerId: 'ws-a', charged: true });
        act(() => h.api.setSelectedBeanId('bean-b', 'New lot'));
        expect(h.api.selectedBeanId).toBe('bean-b');
        act(() => h.api.setSelectedBlendId('blend-b', 'New blend'));
        expect(h.api.selectedBeanId).toBeNull();
        expect(h.api.selectedBlendId).toBe('blend-b');
        expect(h.api.handoffBeanName).toBe('New blend');
        h.unmount();
    });
    it('keeps the running bean and approved reference after the view remounts', async () => {
        localStorage.setItem(DEFAULT_BEAN_KEY, 'bean-a');
        const props = { ...baseSelection, workspaceOwnerId: 'ws-a', beans: [{ id: 'bean-a' }] };
        const first = mountHook(props);
        await act(async () => {
            first.api.setUserSelectedTarget('running-profile');
        });
        act(() => {
            useRoastingStore.getState().startCharge(undefined, 'ws-a', { bt: 180, unit: 'C' });
        });
        const sessionId = useRoastingStore.getState().sessionId;
        first.unmount();
        localStorage.setItem(DEFAULT_BEAN_KEY, 'different-default');
        const recovered = mountHook({
            ...props,
            charged: true,
            selectionEpoch: `ws-a:${sessionId}`,
            userProfile: { default_roast_profile_id: 'different-profile' },
        });
        expect(recovered.api.selectedBeanId).toBe('bean-a');
        expect(recovered.api.targetProfileId).toBe('running-profile');
        expect(useRoastingStore.getState().sessionId).toBe(sessionId);
        recovered.unmount();
    });
    it('does not lose a pending approved profile during StrictMode effect replay', async () => {
        useRoastingStore.getState().setPendingProfile('pending-profile');
        const h = mountHook({ ...baseSelection, confirmTargetChange: async () => true }, true);
        await act(async () => {
            await Promise.resolve();
        });
        expect(h.api.targetProfileId).toBe('pending-profile');
        expect(useRoastingStore.getState().pendingProfileId).toBeNull();
        h.unmount();
    });
    it('ignores a late approval after unmount without stopping Replay', async () => {
        let approve: (value: boolean) => void = () => {};
        const stop = vi.fn();
        const h = mountHook({
            ...baseSelection,
            commitApprovedTarget: stop,
            confirmTargetChange: () =>
                new Promise<boolean>((resolve) => {
                    approve = resolve;
                }),
        });
        act(() => h.api.setUserSelectedTarget('late-profile'));
        h.unmount();
        await act(async () => {
            approve(true);
        });
        expect(useRoastingStore.getState().prepared.profileId).toBe('prof-1');
        expect(stop).not.toHaveBeenCalled();
    });
});
