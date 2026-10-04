// @vitest-environment jsdom
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
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

const renderActions = () => {
    const root = createRoot(document.createElement('div'));
    const setLogEntries = vi.fn();
    const onDrop = vi.fn();
    let latest: ReturnType<typeof useRoastActions>;

    const Probe = () => {
        latest = useRoastActions({
            unit: 'C',
            rawBT: 200,
            setLogEntries,
            onDrop,
            storeStartCharge: useRoastingStore.getState().startCharge,
        });
        return null;
    };

    void act(() => root.render(createElement(Probe)));
    return {
        setLogEntries,
        onDrop,
        get result() {
            return latest;
        },
    };
};

const resetStore = () => {
    useRoastingStore.setState({
        phase: 'standby',
        sessionId: null,
        roastStartMs: 0,
        elapsed: 0,
    });
};

describe('triggerCharge 이중 발화 가드 (#174 manual↔auto race)', () => {
    beforeEach(resetStore);

    it('2회 연속 호출해도 sessionId·기준점 불변, Charge 로그 1회', () => {
        const h = renderActions();

        void act(() => h.result.triggerCharge(200));
        const { sessionId, roastStartMs } = useRoastingStore.getState();
        expect(sessionId).not.toBeNull();

        // 2차 호출은 과거 chargeTimeMs를 줘도 (가드 실패 시 기준점이 이동하도록) 전부 무시돼야 한다
        void act(() => h.result.triggerCharge(195, Date.now() - 3000));
        const after = useRoastingStore.getState();
        expect(after.sessionId).toBe(sessionId);
        expect(after.roastStartMs).toBe(roastStartMs);
        expect(useRoastingStore.getState().logState.entries.filter((entry) => entry.event === 'Charge')).toHaveLength(
            1,
        );
        expect(useRoastingStore.getState().sessionOwnerId).toBe('owner-A');
    });

    it('manual Charge and a past auto-charge onset share one store origin', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-28T04:00:00.000Z'));
        try {
            const h = renderActions();
            void act(() => h.result.triggerCharge(200));
            const manual = useRoastingStore.getState().roastStartMs;
            expect(manual).toBe(Date.now());

            useRoastingStore.getState().reset();
            useRoastingStore.setState({ phase: 'standby' });
            const onset = Date.now() - 4_000;
            void act(() => h.result.triggerCharge(190, onset));
            expect(useRoastingStore.getState().roastStartMs).toBe(onset);
            expect(useRoastingStore.getState().elapsed).toBe(4);
            void act(() => h.result.triggerCharge(180, Date.now() - 9_000));
            expect(useRoastingStore.getState().roastStartMs).toBe(onset);
        } finally {
            vi.useRealTimers();
        }
    });

    it('Charge 명령 실패를 Sentry 경로에 보고한다', async () => {
        const capture = vi.spyOn(logger, 'capture').mockImplementation(() => {});
        vi.mocked(sidecar.startRoast).mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const h = renderActions();
        await act(async () => h.result.triggerCharge(200));
        expect(capture).toHaveBeenCalledWith(expect.objectContaining({ message: 'Roast start command failed' }), {
            reason: 'TypeError: Failed to fetch',
        });
        capture.mockRestore();
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

    it('ended 상태에서는 Charge 로그와 session을 만들지 않는다', () => {
        useRoastingStore.setState({ phase: 'ended', sessionId: 's-ended' });
        const h = renderActions();
        void act(() => h.result.triggerCharge(200));
        expect(h.setLogEntries).not.toHaveBeenCalled();
        expect(useRoastingStore.getState().sessionId).toBe('s-ended');
        expect(useRoastingStore.getState().phase).toBe('ended');
    });
});

describe('handleAutoDrop', () => {
    beforeEach(resetStore);

    it('uses the shared Drop transition, not an End-confirm dialog', () => {
        const h = renderActions();
        void act(() => h.result.handleAutoDrop({ timeSec: 430, bt: 200 }));
        expect(h.onDrop).toHaveBeenCalledTimes(1);
        expect(h.onDrop).toHaveBeenCalledWith({ timeSec: 430, bt: 200 });
        expect(h.setLogEntries).not.toHaveBeenCalled();
    });
});
