// @vitest-environment jsdom
import { useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import { sidecar } from '@shared/lib/sidecar';
import { formatRoastTsvRow, replaceSessionTsv } from '@shared/lib/tsv-writer';
import type { LogEntry } from '@shared/types/roast';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompletedRoastStore } from './completedRoast';
import { useRoastLifecycle } from './useRoastLifecycle';

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        resetRoast: vi.fn().mockResolvedValue({ ok: true }),
        enterStandby: vi.fn().mockResolvedValue({ ok: true }),
        getStatus: vi.fn(),
    },
}));

const feature = vi.hoisted(() => ({ bbp: true }));
vi.mock('@shared/lib/features', () => ({
    FEATURE: { bbp: 'bbp' },
    useFeature: () => feature.bbp,
    useWriteAccess: () => true,
}));

vi.mock('@features/active-roast/model/useBatchQuota', () => ({
    useBatchQuota: () => ({ exceeded: false, isTrial: false, max: 99 }),
}));

vi.mock('@shared/lib/tsv-writer', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/tsv-writer')>();
    return {
        ...actual,
        deleteBbpTsv: vi.fn().mockResolvedValue(undefined),
        replaceSessionTsv: vi.fn().mockResolvedValue(undefined),
    };
});

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
        feature.bbp = true;
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
            awaitingNextCharge: false,
            heatHoldAfterDrop: false,
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
        feature.bbp = true;
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

describe('completeDrop → BBP (#484)', () => {
    beforeEach(() => {
        feature.bbp = true;
        vi.mocked(replaceSessionTsv).mockClear();
        useCompletedRoastStore.getState().clear();
        useBbpStore.setState({ active: false, startMs: 0, points: [], finalized: null, finalizedPoints: [] });
        useRoastingStore.setState({
            phase: 'roasting',
            charged: true,
            isRoasting: true,
            sidecarConnected: true,
            sessionId: 's-a',
            sessionOwnerId: 'owner',
            roastStartMs: 1_000_000,
            elapsed: 612,
            awaitingNextCharge: false,
            heatHoldAfterDrop: false,
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

    it('manual and auto Drop share Drop-time BBP start and Charge wait', () => {
        const h = renderLifecycle([log('Charge', 0), log('FC Start', 480)]);
        try {
            let summary: ReturnType<typeof h.result.completeDrop> | undefined;
            void act(() => {
                summary = h.result.completeDrop({
                    livePoints: [
                        {
                            time: 600,
                            label: '10:00',
                            bt: 205,
                            et: 210,
                            ror: 0,
                            ror_et: 0,
                            heater: 50,
                            fan: 40,
                            drum: 60,
                        },
                        {
                            time: 612,
                            label: '10:12',
                            bt: 150,
                            et: 210,
                            ror: 0,
                            ror_et: 0,
                            heater: 50,
                            fan: 40,
                            drum: 60,
                        },
                    ],
                    onset: { timeSec: 600, bt: 205 },
                });
            });
            expect(summary?.totalTime).toBe('10:00');
            expect(summary?.sessionId).toBe('s-a');
            expect(useBbpStore.getState().active).toBe(true);
            expect(useBbpStore.getState().startMs).toBe(1 + 600_000);
            expect(useBbpStore.getState().points.map((p) => p.bt)).toEqual([205, 150]);
            expect(useRoastingStore.getState().awaitingNextCharge).toBe(true);
            expect(useRoastingStore.getState().heatHoldAfterDrop).toBe(true);
            void act(() => h.result.completeDrop({ livePoints: [], onset: { timeSec: 600, bt: 205 } }));
            expect(useCompletedRoastStore.getState().droppedSessionId).toBe('s-a');
        } finally {
            h.unmount();
        }
    });

    it('Drop cancel restores Charge clock and does not clear heat hold', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-21T00:10:00Z'));
        const h = renderLifecycle([log('Charge', 0), log('FC Start', 480)]);
        try {
            void act(() => {
                h.result.completeDrop({
                    livePoints: [
                        {
                            time: 600,
                            label: '10:00',
                            bt: 205,
                            et: 210,
                            ror: 0,
                            ror_et: 0,
                            heater: null,
                            fan: 0,
                            drum: 0,
                        },
                    ],
                    onset: { timeSec: 600, bt: 205 },
                });
                h.result.resetActiveRoast({ chargeWait: true, keepHeatHold: true });
            });
            expect(useRoastingStore.getState().charged).toBe(false);
            vi.setSystemTime(new Date('2026-09-21T00:12:00Z'));
            void act(() => {
                expect(h.result.cancelDrop()).toBe(true);
            });
            expect(useRoastingStore.getState().phase).toBe('roasting');
            expect(useRoastingStore.getState().sessionId).toBe('s-a');
            expect(useRoastingStore.getState().elapsed).toBe(600);
            expect(useRoastingStore.getState().roastStartMs).toBe(Date.now() - 600_000);
            expect(useRoastingStore.getState().heatHoldAfterDrop).toBe(true);
            expect(useBbpStore.getState().active).toBe(false);
        } finally {
            vi.useRealTimers();
            h.unmount();
        }
    });

    it('rewrites session TSV at Drop so lookback is not uploaded with A', () => {
        const h = renderLifecycle([log('Charge', 0), log('FC Start', 480)]);
        try {
            void act(() => {
                h.result.completeDrop({
                    livePoints: [
                        {
                            time: 600,
                            label: '10:00',
                            bt: 205,
                            et: 210,
                            ror: 1,
                            ror_et: 0,
                            heater: 50,
                            fan: 40,
                            drum: 60,
                            heaterSet: 50,
                        },
                        {
                            time: 612,
                            label: '10:12',
                            bt: 150,
                            et: 210,
                            ror: 0,
                            ror_et: 0,
                            heater: 50,
                            fan: 40,
                            drum: 60,
                            heaterSet: 50,
                        },
                    ],
                    onset: { timeSec: 600, bt: 205 },
                });
            });
            expect(replaceSessionTsv).toHaveBeenCalledWith(
                's-a',
                formatRoastTsvRow({
                    time: 600,
                    bt: 205,
                    et: 210,
                    ror: 1,
                    heater: 50,
                    fan: 40,
                    drum: 60,
                    heaterSet: 50,
                }),
            );
            const written = String(vi.mocked(replaceSessionTsv).mock.calls[0]?.[1] ?? '');
            expect(written).not.toContain('612.00');
        } finally {
            h.unmount();
        }
    });

    it('BBP-disabled accounts still enter Charge wait at Drop', () => {
        feature.bbp = false;
        const h = renderLifecycle([log('Charge', 0)]);
        try {
            void act(() => {
                h.result.completeDrop({
                    livePoints: [
                        {
                            time: 600,
                            label: '10:00',
                            bt: 205,
                            et: 210,
                            ror: 0,
                            ror_et: 0,
                            heater: 50,
                            fan: 40,
                            drum: 60,
                        },
                    ],
                    onset: { timeSec: 600, bt: 205 },
                });
            });
            expect(useBbpStore.getState().active).toBe(false);
            expect(useRoastingStore.getState().awaitingNextCharge).toBe(true);
            expect(useRoastingStore.getState().heatHoldAfterDrop).toBe(true);
        } finally {
            h.unmount();
        }
    });

    it('auto Drop cancel then re-mark starts a new Drop→BBP transition', () => {
        const h = renderLifecycle([log('Charge', 0), log('FC Start', 480)]);
        try {
            void act(() => {
                h.result.completeDrop({
                    livePoints: [
                        {
                            time: 600,
                            label: '10:00',
                            bt: 205,
                            et: 210,
                            ror: 0,
                            ror_et: 0,
                            heater: 50,
                            fan: 40,
                            drum: 60,
                        },
                    ],
                    onset: { timeSec: 600, bt: 205 },
                });
                h.result.resetActiveRoast({ chargeWait: true, keepHeatHold: true });
                expect(h.result.cancelDrop()).toBe(true);
            });
            expect(useCompletedRoastStore.getState().droppedSessionId).toBeNull();
            let second: ReturnType<typeof h.result.completeDrop> | undefined;
            void act(() => {
                second = h.result.completeDrop({
                    livePoints: [
                        {
                            time: 610,
                            label: '10:10',
                            bt: 208,
                            et: 210,
                            ror: 0,
                            ror_et: 0,
                            heater: 50,
                            fan: 40,
                            drum: 60,
                        },
                    ],
                    onset: { timeSec: 610, bt: 208 },
                });
            });
            expect(second?.elapsedSec).toBe(610);
            expect(useBbpStore.getState().startMs).toBe(useRoastingStore.getState().roastStartMs + 610_000);
            expect(useRoastingStore.getState().heatHoldAfterDrop).toBe(true);
        } finally {
            h.unmount();
        }
    });

    it('Drop cancel after next Charge does not rewind B', () => {
        const h = renderLifecycle([log('Charge', 0)]);
        try {
            void act(() => {
                h.result.completeDrop({
                    livePoints: [
                        {
                            time: 600,
                            label: '10:00',
                            bt: 205,
                            et: 210,
                            ror: 0,
                            ror_et: 0,
                            heater: 50,
                            fan: 40,
                            drum: 60,
                        },
                    ],
                    onset: { timeSec: 600, bt: 205 },
                });
                h.result.resetActiveRoast({ chargeWait: true, keepHeatHold: true });
                useRoastingStore.setState({
                    phase: 'roasting',
                    charged: true,
                    isRoasting: true,
                    sessionId: 's-b',
                    awaitingNextCharge: false,
                });
                useCompletedRoastStore.getState().lockAfterCharge('s-b');
            });
            expect(h.result.cancelDrop()).toBe(false);
            expect(useRoastingStore.getState().sessionId).toBe('s-b');
        } finally {
            h.unmount();
        }
    });

    it('restart mid-BBP hydrates Charge wait from local in-progress samples', () => {
        useBbpStore.getState().begin(5_000, [
            { t: 0, bt: 190, et: 200, heater: 50, fan: 40, drum: 60 },
            { t: 2, bt: 188, et: 200, heater: 50, fan: 40, drum: 60 },
        ]);
        useBbpStore.setState({ active: false, startMs: 0, points: [] });
        useRoastingStore.setState({
            phase: 'idle',
            charged: false,
            isRoasting: false,
            sessionId: null,
            awaitingNextCharge: false,
            sidecarConnected: true,
        });
        const h = renderLifecycle();
        try {
            void act(() => h.result.recoverLiveBbp());
            expect(useBbpStore.getState().active).toBe(true);
            expect(useBbpStore.getState().startMs).toBe(5_000);
            expect(useRoastingStore.getState().awaitingNextCharge).toBe(true);
            expect(useRoastingStore.getState().phase).toBe('standby');
        } finally {
            h.unmount();
        }
    });
});
