// @vitest-environment jsdom
import { useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import { sidecar } from '@shared/lib/sidecar';
import type { LogEntry } from '@shared/types/roast';
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

const renderLifecycle = (logEntries: LogEntry[] = []) => {
    const root = createRoot(document.createElement('div'));
    const roastStartTimeRef = { current: 1 };
    let latest: ReturnType<typeof useRoastLifecycle>;
    const Probe = () => {
        latest = useRoastLifecycle({
            phase: useRoastingStore.getState().phase,
            sidecarConnected: true,
            rawBT: 200,
            unit: 'C',
            logEntries,
            timeStr: '8:00',
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

describe('confirmEndRoast roast metrics (#514)', () => {
    beforeEach(() => {
        useBbpStore.setState({ active: false, startMs: 0, points: [], finalized: null });
        useRoastingStore.setState({
            phase: 'roasting',
            charged: true,
            isRoasting: true,
            sidecarConnected: true,
            sessionId: 's1',
            roastStartMs: 0,
            elapsed: 660,
        });
    });

    const log = (event: string, timeSec: number): LogEntry => ({
        id: event,
        time: `${Math.floor(timeSec / 60)}:${String(timeSec % 60).padStart(2, '0')}`,
        timeSec,
        event,
        temp: '0',
        note: '',
    });

    it('summary uses Drop-first 10:00 / 2:00 (20%) and keeps End at record elapsed', () => {
        const h = renderLifecycle([log('Charge', 0), log('FC Start', 480), log('Drop', 600)]);
        try {
            let summary: ReturnType<typeof h.result.confirmEndRoast> | undefined;
            void act(() => {
                summary = h.result.confirmEndRoast();
            });
            expect(summary?.totalTime).toBe('10:00');
            expect(summary?.development).toBe('2:00 (20%)');
            const end = summary?.logEntries.find((e) => e.event === 'End');
            expect(end?.timeSec).toBe(660);
        } finally {
            h.unmount();
        }
    });

    it('no Drop uses End elapsed 11:00 / 3:00 (~27.3%)', () => {
        const h = renderLifecycle([log('Charge', 0), log('FC Start', 480)]);
        try {
            let summary: ReturnType<typeof h.result.confirmEndRoast> | undefined;
            void act(() => {
                summary = h.result.confirmEndRoast();
            });
            expect(summary?.totalTime).toBe('11:00');
            expect(summary?.development).toBe('3:00 (27.3%)');
        } finally {
            h.unmount();
        }
    });
});
