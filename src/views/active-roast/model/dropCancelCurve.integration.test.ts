// @vitest-environment jsdom
import { useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import { _resetTsvWriterForTests, flushTsv, sessionTsvPath } from '@shared/lib/tsv-writer';
import type { LogEntry } from '@shared/types/roast';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { batchRoastFinished } from '../lib/active-roast-screen';
import { useCompletedRoastStore } from './completedRoast';
import { useRoastLifecycle } from './useRoastLifecycle';
import { type LiveRoastPoint, useSidecarPolling } from './useSidecarPolling';

const mocks = vi.hoisted(() => ({
    getTemperatures: vi.fn(),
    getStatus: vi.fn().mockResolvedValue({ connected: true }),
    waitUntilReady: vi.fn().mockResolvedValue({ connected: true }),
    resetRoast: vi.fn().mockResolvedValue({ ok: true }),
    enterStandby: vi.fn().mockResolvedValue({ ok: true }),
    listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: mocks.listen,
}));

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        getTemperatures: mocks.getTemperatures,
        getStatus: mocks.getStatus,
        waitUntilReady: mocks.waitUntilReady,
        resetRoast: mocks.resetRoast,
        enterStandby: mocks.enterStandby,
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

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const files = new Map<string, string>();
let readingBt = 200;

const chargeLog = (bt: number): LogEntry => ({
    id: 'charge',
    time: '0:00',
    timeSec: 0,
    event: 'Charge',
    temp: String(bt),
    tempC: bt,
    note: '',
});

const point = (time: number, bt: number): LiveRoastPoint => ({
    time,
    label: `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`,
    bt,
    et: 210,
    ror: 1,
    ror_et: 1,
    heater: 40,
    fan: 30,
    drum: 50,
});

/** Issue probe: Charge 200, then 150, 180, plus a post-Drop sample that must be clipped. */
const planted = [point(0, 200), point(4, 150), point(8, 180), point(12, 100)];

type Harness = {
    points: LiveRoastPoint[];
    logs: LogEntry[];
    setLogs: (entries: LogEntry[]) => void;
    setPoints: (points: LiveRoastPoint[]) => void;
    lifecycle: ReturnType<typeof useRoastLifecycle>;
    disconnects: () => number;
    unmount: () => void;
};

const disconnects: boolean[] = [];

const setConnected = (connected: boolean, capabilities?: string[]) => {
    disconnects.push(connected);
    useRoastingStore.getState().setConnected(connected, capabilities);
};

const flush = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
};

const renderRoast = (): Harness => {
    const harness = {
        points: [] as LiveRoastPoint[],
        logs: [] as LogEntry[],
        setLogs: (_entries: LogEntry[]) => {},
        setPoints: (_points: LiveRoastPoint[]) => {},
        lifecycle: null as unknown as ReturnType<typeof useRoastLifecycle>,
    };
    const root = createRoot(document.createElement('div'));
    const Probe = () => {
        const phase = useRoastingStore((s) => s.phase);
        const sessionId = useRoastingStore((s) => s.sessionId);
        const sidecarConnected = useRoastingStore((s) => s.sidecarConnected);
        const [logs, setLogs] = useState<LogEntry[]>([]);
        const { livePoints, setLivePoints } = useSidecarPolling({
            isActive: true,
            phase,
            pollIntervalMs: 1000,
            enterPreheating: () => useRoastingStore.getState().enterPreheating(),
            setConnected,
            sessionId,
            chargeBt: logs.find((entry) => entry.event === 'Charge')?.tempC ?? null,
        });
        const lifecycle = useRoastLifecycle({
            phase,
            sidecarConnected,
            rawBT: readingBt,
            unit: 'C',
            logEntries: logs,
            timeStr: '0:08',
            enterStandby: () => useRoastingStore.getState().enterStandby(),
            enterPreheating: () => useRoastingStore.getState().enterPreheating(),
            setConnected,
            resetStore: () => useRoastingStore.getState().reset(),
            resetAutoDetectionRef: { current: () => undefined },
            disableAutoChargeRef: { current: () => undefined },
            disableAutoDropRef: { current: () => undefined },
            rearmAutoChargeRef: { current: () => undefined },
            setLogEntries: setLogs,
            setLivePoints,
            setZoomRange: () => undefined,
            setHoveredChartIndex: () => undefined,
            triggerChargeRef: { current: () => undefined },
        });
        harness.points = livePoints;
        harness.logs = logs;
        harness.setLogs = setLogs;
        harness.setPoints = setLivePoints;
        harness.lifecycle = lifecycle;
        return null;
    };
    act(() => root.render(createElement(Probe)));
    return Object.assign(harness, {
        disconnects: () => disconnects.filter((connected) => connected === false).length,
        unmount: () => {
            act(() => root.unmount());
        },
    });
};

const emptyBbp = {
    active: false,
    recording: false,
    liveGeneration: '',
    startMs: 0,
    points: [],
    finalized: null,
    finalizedPoints: [],
};

beforeEach(() => {
    feature.bbp = true;
    readingBt = 200;
    disconnects.length = 0;
    files.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    mocks.getStatus.mockResolvedValue({ connected: true });
    mocks.waitUntilReady.mockResolvedValue({ connected: true });
    mocks.resetRoast.mockClear().mockResolvedValue({ ok: true });
    mocks.enterStandby.mockClear();
    mocks.listen.mockResolvedValue(() => {});
    let stamp = 1;
    mocks.getTemperatures.mockImplementation(async () => ({
        bt: readingBt,
        bt_raw: readingBt,
        timestamp: stamp++,
        et: 210,
        ror: 1,
        ror_et: 1,
        heater: 40,
        fan: 30,
        drum: 50,
    }));
    _resetTsvWriterForTests({
        write: async (path, contents, options) => {
            const prev = files.get(path) ?? '';
            files.set(path, options.append ? prev + contents : contents);
        },
        remove: async (path) => {
            files.delete(path);
        },
    });
    useBbpStore.setState(emptyBbp);
    useCompletedRoastStore.getState().clear();
    useRoastingStore.setState({
        phase: 'standby',
        sidecarConnected: true,
        sessionId: null,
        sessionOwnerId: 'owner',
        roastStartMs: 0,
        elapsed: 0,
        awaitingNextCharge: false,
        heatHoldAfterDrop: false,
        liveData: null,
    });
    localStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
    useRoastingStore.getState().reset();
    useBbpStore.setState(emptyBbp);
    useCompletedRoastStore.getState().clear();
    _resetTsvWriterForTests();
    localStorage.clear();
});

const chargeAndPlant = async (harness: Harness) => {
    await flush();
    await act(async () => {
        harness.setLogs([chargeLog(200)]);
        useRoastingStore.getState().startCharge(Date.now(), 'owner');
    });
    await flush();
    await act(async () => {
        harness.setPoints(planted);
    });
    const sessionId = useRoastingStore.getState().sessionId;
    expect(sessionId).toEqual(expect.any(String));
    return sessionId as string;
};

const dropPlanted = (harness: Harness, onset: boolean) => {
    if (!onset) useRoastingStore.setState({ elapsed: 8 });
    act(() => {
        harness.lifecycle.finishDrop({
            livePoints: planted,
            ...(onset ? { onset: { timeSec: 8, bt: 180 } } : {}),
            commitSummary: () => undefined,
            holdAutoChargeUntilRecovery: () => undefined,
        });
    });
};

describe('Drop cancel keeps the roast curve (#638)', () => {
    it('auto Drop cancel restores [200, 150, 180], clips the TSV, and the next poll appends', async () => {
        const harness = renderRoast();
        try {
            const sessionId = await chargeAndPlant(harness);
            const path = sessionTsvPath(sessionId);
            dropPlanted(harness, true);
            await act(async () => {
                await flushTsv(sessionId);
            });
            const clipped = files.get(path) ?? '';
            expect(clipped).toContain('4.00\t150\t');
            expect(clipped).toContain('8.00\t180\t');
            expect(clipped).not.toContain('12.00\t100\t');

            readingBt = 210;
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1000);
            });
            expect(harness.points.some((sample) => sample.bt === 210)).toBe(true);

            const resets = mocks.resetRoast.mock.calls.length;
            const droppedConnections = harness.disconnects();
            await act(async () => {
                expect(harness.lifecycle.cancelDrop()).toBe(true);
            });
            await flush();

            expect(harness.points.map((sample) => sample.bt)).toEqual([200, 150, 180]);
            expect(harness.logs.map((entry) => entry.event)).toEqual(['Charge']);
            expect(useRoastingStore.getState().phase).toBe('roasting');
            expect(useRoastingStore.getState().sessionId).toBe(sessionId);
            expect(useRoastingStore.getState().elapsed).toBe(8);
            expect(useRoastingStore.getState().heatHoldAfterDrop).toBe(false);
            expect(useRoastingStore.getState().sidecarConnected).toBe(true);
            expect(mocks.resetRoast).toHaveBeenCalledTimes(resets);
            expect(harness.disconnects()).toBe(droppedConnections);
            expect(
                batchRoastFinished(
                    useRoastingStore.getState().heatHoldAfterDrop,
                    false,
                    harness.logs.some((entry) => entry.event === 'Drop'),
                ),
            ).toBe(false);
            expect(useBbpStore.getState().finalized).toBeNull();
            expect(useBbpStore.getState().active).toBe(false);

            await act(async () => {
                await flushTsv(sessionId);
            });
            expect(files.get(path)).toContain('4.00\t150\t');
            expect(files.get(path)).not.toContain('12.00\t100\t');

            readingBt = 216;
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1000);
            });
            expect(harness.points.map((sample) => sample.bt).slice(0, 3)).toEqual([200, 150, 180]);
            expect(harness.points).toHaveLength(4);
            expect(harness.points[3]?.bt).toBe(216);
            expect(harness.points[3]?.time).toBeGreaterThan(8);

            await act(async () => {
                await flushTsv(sessionId);
            });
            const continued = files.get(path) ?? '';
            expect(continued).toContain('4.00\t150\t');
            expect(continued).toContain('8.00\t180\t');
            expect(continued).toContain('\t216\t');

            act(() => {
                harness.lifecycle.finishDrop({
                    livePoints: harness.points,
                    onset: { timeSec: harness.points[3].time, bt: 216 },
                    commitSummary: () => undefined,
                    holdAutoChargeUntilRecovery: () => undefined,
                });
            });
            await act(async () => {
                await flushTsv(sessionId);
            });
            const resaved = files.get(path) ?? '';
            expect(resaved).toContain('4.00\t150\t');
            expect(resaved).toContain('8.00\t180\t');
            expect(resaved).toContain('\t216\t');
            expect(resaved).not.toContain('12.00\t100\t');
        } finally {
            harness.unmount();
        }
    });

    it('BBP off: manual Drop cancel restores the series and unlocks heat control', async () => {
        feature.bbp = false;
        const harness = renderRoast();
        try {
            await chargeAndPlant(harness);
            dropPlanted(harness, false);
            readingBt = 210;
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1000);
            });
            const droppedConnections = harness.disconnects();
            await act(async () => {
                expect(harness.lifecycle.cancelDrop()).toBe(true);
            });
            await flush();
            expect(harness.points.map((sample) => sample.bt)).toEqual([200, 150, 180]);
            expect(useBbpStore.getState().active).toBe(false);
            expect(useRoastingStore.getState().heatHoldAfterDrop).toBe(false);
            expect(useRoastingStore.getState().sidecarConnected).toBe(true);
            expect(harness.disconnects()).toBe(droppedConnections);
            expect(
                batchRoastFinished(
                    useRoastingStore.getState().heatHoldAfterDrop,
                    false,
                    harness.logs.some((entry) => entry.event === 'Drop'),
                ),
            ).toBe(false);
        } finally {
            harness.unmount();
        }
    });

    it('the next Charge still seeds 00:00 and finalizes BBP over a long wait curve', async () => {
        const harness = renderRoast();
        try {
            const droppedId = await chargeAndPlant(harness);
            dropPlanted(harness, true);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(3000);
            });
            expect(harness.points.length).toBeGreaterThan(2);

            await act(async () => {
                useBbpStore.getState().begin(Date.now() - 3000, [
                    { t: 0, bt: 190, et: 200, heater: null, fan: 0, drum: 0 },
                    { t: 2, bt: 188, et: 200, heater: null, fan: 0, drum: 0 },
                ]);
                harness.setLogs([chargeLog(210)]);
                useRoastingStore.getState().startCharge();
            });

            expect(harness.points.map((sample) => [sample.time, sample.bt])).toEqual([[0, 210]]);
            expect(useRoastingStore.getState().sessionId).not.toBe(droppedId);
            expect(useRoastingStore.getState().heatHoldAfterDrop).toBe(false);
            expect(useBbpStore.getState().finalized?.sessionId).toBe(useRoastingStore.getState().sessionId);
        } finally {
            harness.unmount();
        }
    });
});
