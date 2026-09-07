// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoastingStore } from './status';
import { useRoastActions } from './useRoastActions';

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: { startRoast: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner-A' }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderActions = (roastStartTimeRef: { current: number }) => {
    const root = createRoot(document.createElement('div'));
    const setLogEntries = vi.fn();
    let latest: ReturnType<typeof useRoastActions>;

    const Probe = () => {
        latest = useRoastActions({
            unit: 'C',
            rawBT: 200,
            setLogEntries,
            setIsRunning: vi.fn(),
            setShowEndRoastModal: vi.fn(),
            storeStartCharge: (ms, ownerId) => useRoastingStore.getState().startCharge(ms, ownerId),
            roastStartTimeRef: roastStartTimeRef as React.MutableRefObject<number>,
        });
        return null;
    };

    void act(() => root.render(createElement(Probe)));
    return {
        setLogEntries,
        get result() {
            return latest;
        },
    };
};

const resetStore = () => {
    useRoastingStore.setState({
        phase: 'standby',
        charged: false,
        isRoasting: false,
        sessionId: null,
        roastStartMs: 0,
        elapsed: 0,
    });
};

describe('triggerCharge 이중 발화 가드 (#174 manual↔auto race)', () => {
    beforeEach(resetStore);

    it('2회 연속 호출해도 sessionId·기준점 불변, Charge 로그 1회', () => {
        const ref = { current: 0 };
        const h = renderActions(ref);

        void act(() => h.result.triggerCharge(200));
        const { sessionId, roastStartMs } = useRoastingStore.getState();
        expect(sessionId).not.toBeNull();
        const originAfterFirst = ref.current;

        // 2차 호출은 과거 chargeTimeMs를 줘도 (가드 실패 시 기준점이 이동하도록) 전부 무시돼야 한다
        void act(() => h.result.triggerCharge(195, Date.now() - 3000));
        const after = useRoastingStore.getState();
        expect(after.sessionId).toBe(sessionId);
        expect(after.roastStartMs).toBe(roastStartMs);
        expect(ref.current).toBe(originAfterFirst);
        expect(h.setLogEntries).toHaveBeenCalledTimes(1);
        expect(useRoastingStore.getState().sessionOwnerId).toBe('owner-A');
    });
});

describe('startCharge 심층 방어 가드 (#174)', () => {
    beforeEach(resetStore);

    it('charged 상태에서 재호출해도 sessionId 재생성 안 함', () => {
        useRoastingStore.getState().startCharge();
        const first = useRoastingStore.getState().sessionId;
        useRoastingStore.getState().startCharge();
        expect(useRoastingStore.getState().sessionId).toBe(first);
    });
});
