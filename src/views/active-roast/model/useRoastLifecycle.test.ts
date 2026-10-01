// @vitest-environment jsdom
import { useBbpStore } from '@features/active-roast/model/bbp';
import { updateRoastSettings } from '@features/active-roast/model/settings';
import { useRoastingStore } from '@features/active-roast/model/status';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { formatRoastTsvRow, formatTsvRows, replaceSessionTsv } from '@shared/lib/tsv-writer';
import type { LogEntry } from '@shared/types/roast';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompletedRoastStore } from './completedRoast';
import { useRoastLifecycle } from './useRoastLifecycle';

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(null),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));

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

const renderLifecycle = (
    logEntries: LogEntry[] = [],
    detection: {
        resetAutoDetection?: () => void;
        disableAutoCharge?: () => void;
        disableAutoDrop?: () => void;
        triggerCharge?: () => void;
    } = {},
) => {
    const root = createRoot(document.createElement('div'));
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
            resetStore: () => useRoastingStore.getState().reset(),
            resetAutoDetectionRef: { current: detection.resetAutoDetection ?? (() => undefined) },
            disableAutoChargeRef: { current: detection.disableAutoCharge ?? (() => undefined) },
            disableAutoDropRef: { current: detection.disableAutoDrop ?? (() => undefined) },
            rearmAutoChargeRef: { current: () => undefined },
            setLogEntries: vi.fn(),
            setLivePoints: vi.fn(),
            setZoomRange: vi.fn(),
            setHoveredChartIndex: vi.fn(),
            triggerChargeRef: { current: detection.triggerCharge ?? (() => undefined) },
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
        updateRoastSettings({ pidDropBehavior: 'hold' });
        vi.mocked(sidecar.resetRoast).mockReset().mockResolvedValue({ ok: true });
        vi.mocked(sidecar.enterStandby).mockClear();
        useBbpStore.setState({ active: false, liveGeneration: '', startMs: 0, points: [], finalized: null });
        useRoastingStore.setState({
            phase: 'ended',
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

    it.each([
        { keepHeatHold: true, pidDropBehavior: 'hold', expectedMode: 'hold' },
        { keepHeatHold: false, pidDropBehavior: 'hold', expectedMode: 'zero' },
        { keepHeatHold: true, pidDropBehavior: 'zero', expectedMode: 'zero' },
        { keepHeatHold: false, pidDropBehavior: 'zero', expectedMode: 'zero' },
    ] as const)(
        'reset forwards configured mode $expectedMode for $pidDropBehavior, hold flag $keepHeatHold',
        ({ keepHeatHold, pidDropBehavior, expectedMode }) => {
            updateRoastSettings({ pidDropBehavior });
            const h = renderLifecycle();
            try {
                void act(() => h.result.resetActiveRoast({ keepHeatHold }));
                expect(sidecar.resetRoast).toHaveBeenCalledWith(expectedMode);
            } finally {
                h.unmount();
            }
        },
    );

    it('배치 리셋 명령 실패를 Sentry 경로에 보고한다', async () => {
        const capture = vi.spyOn(logger, 'capture').mockImplementation(() => {});
        vi.mocked(sidecar.resetRoast).mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const h = renderLifecycle();
        try {
            await act(async () => h.result.resetActiveRoast());
            expect(capture).toHaveBeenCalledWith(expect.objectContaining({ message: 'Roast reset command failed' }), {
                reason: 'TypeError: Failed to fetch',
            });
        } finally {
            capture.mockRestore();
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
        useBbpStore.setState({ active: false, liveGeneration: '', startMs: 0, points: [], finalized: null });
        useRoastingStore.setState({
            phase: 'roasting',
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
        useBbpStore.setState({
            active: false,
            liveGeneration: '',
            startMs: 0,
            points: [],
            finalized: null,
            finalizedPoints: [],
        });
        useRoastingStore.setState({
            phase: 'roasting',
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
            expect(useBbpStore.getState().startMs).toBe(1_000_000 + 600_000);
            expect(useCompletedRoastStore.getState().restore?.roastStartMs).toBe(1_000_000);
            expect(useBbpStore.getState().points.map((p) => p.bt)).toEqual([205, 150]);
            expect(useRoastingStore.getState().awaitingNextCharge).toBe(true);
            expect(useRoastingStore.getState().heatHoldAfterDrop).toBe(true);
            void act(() => h.result.completeDrop({ livePoints: [], onset: { timeSec: 600, bt: 205 } }));
            expect(useCompletedRoastStore.getState().droppedSessionId).toBe('s-a');
        } finally {
            h.unmount();
        }
    });

    it('finishDrop holds auto Charge through cool-down while auto Drop stays off', () => {
        const order: string[] = [];
        const armed = { charge: false, drop: false };
        const h = renderLifecycle([log('Charge', 0), log('FC Start', 480)], {
            resetAutoDetection: () => {
                order.push('reset');
                armed.charge = true;
                armed.drop = true;
            },
            disableAutoCharge: () => {
                order.push('disable-charge');
                armed.charge = false;
            },
            disableAutoDrop: () => {
                order.push('disable-drop');
                armed.drop = false;
            },
        });
        const commitSummary = vi.fn();
        const holdAutoChargeUntilRecovery = vi.fn(() => {
            order.push('hold-charge');
            armed.charge = false;
        });
        try {
            let summary: ReturnType<typeof h.result.finishDrop> | undefined;
            void act(() => {
                summary = h.result.finishDrop({
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
                    commitSummary,
                    holdAutoChargeUntilRecovery,
                });
            });
            expect(summary?.sessionId).toBe('s-a');
            expect(commitSummary).toHaveBeenCalledTimes(1);
            expect(order).toEqual(['disable-drop', 'reset', 'disable-drop', 'hold-charge']);
            expect(armed).toEqual({ charge: false, drop: false });
            expect(useRoastingStore.getState().awaitingNextCharge).toBe(true);
            expect(useRoastingStore.getState().heatHoldAfterDrop).toBe(true);
            expect(useCompletedRoastStore.getState().droppedSessionId).toBe('s-a');

            void act(() => {
                const again = h.result.finishDrop({
                    livePoints: [],
                    onset: { timeSec: 600, bt: 205 },
                    commitSummary,
                    holdAutoChargeUntilRecovery,
                });
                expect(again).toBeNull();
            });
            expect(commitSummary).toHaveBeenCalledTimes(1);
            expect(holdAutoChargeUntilRecovery).toHaveBeenCalledTimes(1);
            expect(useCompletedRoastStore.getState().droppedSessionId).toBe('s-a');
        } finally {
            h.unmount();
        }
    });

    it('Drop cancel restores Charge clock and does not clear heat hold', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-21T00:10:00Z'));
        useRoastingStore.setState({ roastStartMs: Date.now() - 600_000 });
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
            expect(useRoastingStore.getState().phase).toBe('standby');
            vi.setSystemTime(new Date('2026-09-21T00:12:00Z'));
            void act(() => {
                expect(h.result.cancelDrop()).toBe(true);
            });
            expect(useRoastingStore.getState().phase).toBe('roasting');
            expect(useRoastingStore.getState().sessionId).toBe('s-a');
            expect(useRoastingStore.getState().elapsed).toBe(720);
            expect(useRoastingStore.getState().roastStartMs).toBe(Date.now() - 720_000);
            expect(useRoastingStore.getState().heatHoldAfterDrop).toBe(true);
            expect(useBbpStore.getState().active).toBe(false);
            vi.setSystemTime(new Date('2026-09-21T00:12:03Z'));
            useRoastingStore.getState().tick();
            expect(useRoastingStore.getState().elapsed).toBe(723);
            expect(useRoastingStore.getState().phase).toBe('roasting');
        } finally {
            vi.useRealTimers();
            h.unmount();
        }
    });

    it('rewrites session TSV at Drop so lookback is not uploaded with A', () => {
        const processing = {
            algorithm_version: 'ema-least-squares-v1',
            temperature_unit: 'C',
            ror_unit: 'C/min',
            timestamp_clock: 'sidecar-monotonic-seconds',
            display_ema_alpha: 0.16,
            ror_ema_alpha: 0.2,
            ror_window_sec: 30,
            ror_warmup_reads: 3,
        } as const;

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
                            sensorTimestamp: 123.456789,
                            sensorClock: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
                            processing,
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
                formatTsvRows(
                    [
                        {
                            time: 600,
                            bt: 205,
                            et: 210,
                            ror: 1,
                            ror_et: 0,
                            heater: 50,
                            fan: 40,
                            drum: 60,
                            heaterSet: 50,
                            sensorTimestamp: 123.456789,
                            sensorClock: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
                            processing,
                        },
                    ],
                    formatRoastTsvRow,
                ),
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

    it('same-tab reload hydrates Charge wait from the current BBP', () => {
        useBbpStore.getState().begin(5_000, [
            { t: 0, bt: 190, et: 200, heater: 50, fan: 40, drum: 60 },
            { t: 2, bt: 188, et: 200, heater: 50, fan: 40, drum: 60 },
        ]);
        useBbpStore.setState({ active: false, liveGeneration: '', startMs: 0, points: [] });
        useRoastingStore.setState({
            phase: 'idle',
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
            localStorage.removeItem('fc_bbp_live');
            sessionStorage.removeItem('fc_bbp_live_gen');
        }
    });

    it('app restart does not hydrate an earlier BBP', () => {
        useBbpStore.getState().begin(5_000, [
            { t: 0, bt: 190, et: 200, heater: 50, fan: 40, drum: 60 },
            { t: 2, bt: 188, et: 200, heater: 50, fan: 40, drum: 60 },
        ]);
        useBbpStore.setState({ active: false, liveGeneration: '', startMs: 0, points: [] });
        sessionStorage.removeItem('fc_bbp_live_gen');
        useRoastingStore.setState({
            phase: 'idle',
            sessionId: null,
            awaitingNextCharge: false,
            sidecarConnected: true,
        });
        const h = renderLifecycle();
        try {
            void act(() => h.result.recoverLiveBbp());
            expect(useBbpStore.getState().active).toBe(false);
            expect(useRoastingStore.getState().awaitingNextCharge).toBe(false);
            expect(useRoastingStore.getState().phase).toBe('idle');
        } finally {
            h.unmount();
            localStorage.removeItem('fc_bbp_live');
            sessionStorage.removeItem('fc_bbp_live_gen');
        }
    });

    it.each(['roasting', 'ended'] as const)('does not hydrate BBP while phase is %s', (phase) => {
        useBbpStore.getState().begin(5_000, [
            { t: 0, bt: 190, et: 200, heater: 50, fan: 40, drum: 60 },
            { t: 2, bt: 188, et: 200, heater: 50, fan: 40, drum: 60 },
        ]);
        useBbpStore.setState({ active: false, liveGeneration: '', startMs: 0, points: [] });
        useRoastingStore.setState({
            phase,
            sessionId: 's-live',
            awaitingNextCharge: false,
            sidecarConnected: true,
        });
        const h = renderLifecycle();
        try {
            void act(() => h.result.recoverLiveBbp());
            expect(useBbpStore.getState().active).toBe(false);
            expect(useRoastingStore.getState().awaitingNextCharge).toBe(false);
        } finally {
            h.unmount();
            localStorage.removeItem('fc_bbp_live');
            sessionStorage.removeItem('fc_bbp_live_gen');
        }
    });
});

describe('manual Charge while ended (#630)', () => {
    beforeEach(() => {
        vi.mocked(sidecar.getStatus).mockReset().mockResolvedValue({
            connected: true,
            roaster: '',
            display_name: '',
            brand: '',
            capabilities: [],
            uptime: 0,
            error: null,
        });
        useRoastingStore.setState({
            phase: 'ended',
            sessionId: 's-ended',
            roastStartMs: 0,
            sidecarConnected: true,
        });
    });

    it('does not start a new session', async () => {
        const triggerCharge = vi.fn();
        const h = renderLifecycle([], { triggerCharge });
        try {
            await act(async () => {
                await h.result.handleManualCharge();
            });
            expect(triggerCharge).not.toHaveBeenCalled();
            expect(useRoastingStore.getState().sessionId).toBe('s-ended');
            expect(useRoastingStore.getState().phase).toBe('ended');
        } finally {
            h.unmount();
        }
    });
});
