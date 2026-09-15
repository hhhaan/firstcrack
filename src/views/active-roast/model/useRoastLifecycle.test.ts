// @vitest-environment jsdom
import { useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import { sidecar } from '@shared/lib/sidecar';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoastLifecycle } from './useRoastLifecycle';

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        resetRoast: vi.fn().mockResolvedValue({ ok: true }),
        enterStandby: vi.fn().mockResolvedValue({ ok: true }),
        getStatus: vi.fn(),
    },
}));

vi.mock('@shared/lib/features', () => ({
    FEATURE: { bbp: 'bbp' },
    useFeature: () => true,
    useWriteAccess: () => true,
}));

vi.mock('@features/active-roast/model/useBatchQuota', () => ({
    useBatchQuota: () => ({ exceeded: false, isTrial: false, max: 99 }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ message: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderLifecycle = () => {
    const root = createRoot(document.createElement('div'));
    const roastStartTimeRef = { current: 1 };
    let latest: ReturnType<typeof useRoastLifecycle>;
    const Probe = () => {
        latest = useRoastLifecycle({
            phase: useRoastingStore.getState().phase,
            sidecarConnected: true,
            rawBT: 200,
            unit: 'C',
            logEntries: [],
            timeStr: '8:00',
            devTimeStr: '1:00',
            enterStandby: () => useRoastingStore.getState().enterStandby(),
            enterPreheating: () => useRoastingStore.getState().enterPreheating(),
            storeEndRoast: () => useRoastingStore.getState().endRoast(),
            setConnected: () => undefined,
            setIsRunning: vi.fn(),
            resetStore: () => useRoastingStore.getState().reset(),
            resetAutoDetectionRef: { current: () => undefined },
            disableAutoChargeRef: { current: () => undefined },
            rearmAutoChargeRef: { current: () => undefined },
            setLogEntries: vi.fn(),
            setLivePoints: vi.fn(),
            setZoomRange: vi.fn(),
            setHoveredChartIndex: vi.fn(),
            triggerChargeRef: { current: () => undefined },
            roastStartTimeRef,
        });
        return null;
    };
    void act(() => root.render(createElement(Probe)));
    return {
        get result() {
            return latest;
        },
        unmount: () => {
            void act(() => root.unmount());
        },
    };
};

describe('resetActiveRoast after End (#455)', () => {
    beforeEach(() => {
        vi.mocked(sidecar.resetRoast).mockClear();
        vi.mocked(sidecar.enterStandby).mockClear();
        useBbpStore.setState({ active: false, startMs: 0, points: [], finalized: null });
        useRoastingStore.setState({
            phase: 'ended',
            charged: true,
            isRoasting: false,
            sidecarConnected: true,
            sessionId: 's1',
            roastStartMs: 0,
            elapsed: 0,
        });
    });

    it('BBP 중이면 Roast Ready를 건너뛰고 charge 대기(standby)', () => {
        useBbpStore.getState().begin(Date.now());
        const h = renderLifecycle();
        try {
            void act(() => h.result.resetActiveRoast());
            expect(useRoastingStore.getState().phase).toBe('standby');
            expect(sidecar.resetRoast).toHaveBeenCalled();
            expect(sidecar.enterStandby).not.toHaveBeenCalled();
        } finally {
            h.unmount();
        }
    });

    it('BBP가 없으면 첫 배치처럼 preheating (Roast Ready)', () => {
        const h = renderLifecycle();
        try {
            void act(() => h.result.resetActiveRoast());
            expect(useRoastingStore.getState().phase).toBe('preheating');
        } finally {
            h.unmount();
        }
    });
});
