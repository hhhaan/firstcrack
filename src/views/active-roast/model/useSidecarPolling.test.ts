// @vitest-environment jsdom
import { useRoastingStore } from '@features/active-roast/model/status';
import { useAutoDetection } from '@features/active-roast/model/useAutoDetection';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSidecarPolling } from './useSidecarPolling';
import hookSrc from './useSidecarPolling.ts?raw';

const mocks = vi.hoisted(() => ({
    enqueueTsvRow: vi.fn(),
    initSessionTsv: vi.fn(),
    getTemperatures: vi.fn(),
    getStatus: vi.fn().mockResolvedValue({ connected: true }),
    waitUntilReady: vi.fn().mockResolvedValue({ connected: true }),
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
    },
}));

vi.mock('@shared/lib/tsv-writer', () => ({
    enqueueTsvRow: mocks.enqueueTsvRow,
    initSessionTsv: mocks.initSessionTsv,
    writeBbpTsv: vi.fn(),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
    mocks.waitUntilReady.mockResolvedValue({ connected: true });
    mocks.getStatus.mockResolvedValue({ connected: true });
    mocks.listen.mockResolvedValue(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    useRoastingStore.getState().reset();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

const flushReady = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

const stubTemps = () =>
    mocks.getTemperatures.mockResolvedValue({
        bt: 200,
        et: 210,
        ror: 5,
        ror_et: 4,
        heater: 80,
        fan: 40,
        drum: 60,
    });

const renderProbe = (pollIntervalMs: number) => {
    useRoastingStore.setState({ phase: 'roasting', sessionId: 'issue-308' });
    const roastStartTimeRef = { current: Date.now() - 1000 };
    const root = createRoot(document.createElement('div'));
    const Probe = () => {
        useSidecarPolling({
            isActive: true,
            phase: 'roasting',
            pollIntervalMs,
            enterPreheating: vi.fn(),
            setConnected: vi.fn(),
            roastStartTimeRef,
            sessionId: 'issue-308',
        });
        return null;
    };
    act(() => root.render(createElement(Probe)));
    return root;
};

it('enqueues the first sample with controls while TSV initialization is pending', async () => {
    let finishInit = () => {};
    mocks.initSessionTsv.mockReturnValue(
        new Promise<void>((resolve) => {
            finishInit = resolve;
        }),
    );
    mocks.getTemperatures.mockResolvedValue({
        bt: 200,
        et: 210,
        ror: 5,
        ror_et: 4,
        heater: 80,
        fan: 40,
        drum: 60,
        heater_set: 75,
    });

    useRoastingStore.setState({
        phase: 'roasting',
        sessionId: 'issue-315',
        roastStartMs: Date.now() - 1000,
    });
    const roastStartTimeRef = { current: Date.now() - 1000 };
    const root = createRoot(document.createElement('div'));

    const Probe = () => {
        useSidecarPolling({
            isActive: true,
            phase: 'roasting',
            pollIntervalMs: 60_000,
            enterPreheating: vi.fn(),
            setConnected: vi.fn(),
            roastStartTimeRef,
            sessionId: 'issue-315',
        });
        return null;
    };

    try {
        act(() => root.render(createElement(StrictMode, null, createElement(Probe))));
        await flushReady();
        await vi.waitFor(() => expect(mocks.getTemperatures).toHaveBeenCalled());

        expect(mocks.enqueueTsvRow).toHaveBeenCalledOnce();
        const [sessionId, row] = mocks.enqueueTsvRow.mock.calls[0];
        expect(sessionId).toBe('issue-315');
        expect(row).toMatch(/\t80\t40\t60\t75\n$/);
    } finally {
        await act(async () => {
            finishInit();
            root.unmount();
        });
    }
});

it('accepts the first sample when roast-relative time moves backwards for a new batch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T12:00:00Z'));
    mocks.initSessionTsv.mockResolvedValue(undefined);
    mocks.getTemperatures.mockResolvedValue({
        bt: 200,
        et: 210,
        ror: 5,
        ror_et: 4,
        heater: 80,
        fan: 40,
        drum: 60,
    });

    useRoastingStore.setState({ phase: 'roasting', sessionId: 'issue-315' });
    const roastStartTimeRef = { current: Date.now() - 100_000 };
    const root = createRoot(document.createElement('div'));

    const Probe = () => {
        useSidecarPolling({
            isActive: true,
            phase: 'roasting',
            pollIntervalMs: 500,
            enterPreheating: vi.fn(),
            setConnected: vi.fn(),
            roastStartTimeRef,
            sessionId: 'issue-315',
        });
        return null;
    };

    try {
        act(() => root.render(createElement(Probe)));
        await flushReady();
        expect(mocks.enqueueTsvRow).toHaveBeenCalledOnce();

        roastStartTimeRef.current = Date.now();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });

        expect(mocks.enqueueTsvRow).toHaveBeenCalledTimes(2);
    } finally {
        act(() => root.unmount());
    }
});

it('stale:true skips TSV and livePoints but still updates liveData', async () => {
    mocks.initSessionTsv.mockResolvedValue(undefined);
    mocks.getTemperatures.mockResolvedValue({
        bt: 200,
        et: 210,
        ror: 5,
        ror_et: 4,
        heater: 80,
        fan: 40,
        drum: 60,
        stale: true,
    });

    useRoastingStore.setState({
        phase: 'roasting',
        sessionId: 'issue-357',
        roastStartMs: Date.now() - 1000,
        elapsed: 0,
        liveData: null,
    });
    const roastStartTimeRef = { current: Date.now() - 1000 };
    const root = createRoot(document.createElement('div'));
    let livePoints: unknown[] = [];

    const Probe = () => {
        const r = useSidecarPolling({
            isActive: true,
            phase: 'roasting',
            pollIntervalMs: 60_000,
            enterPreheating: vi.fn(),
            setConnected: vi.fn(),
            roastStartTimeRef,
            sessionId: 'issue-357',
        });
        livePoints = r.livePoints;
        return null;
    };

    try {
        act(() => root.render(createElement(Probe)));
        await flushReady();
        await vi.waitFor(() => expect(mocks.getTemperatures).toHaveBeenCalled());

        expect(mocks.enqueueTsvRow).not.toHaveBeenCalled();
        expect(livePoints).toEqual([]);
        expect(useRoastingStore.getState().liveData?.bt).toBe(200);
        expect(useRoastingStore.getState().elapsed).toBeGreaterThan(0);
    } finally {
        act(() => root.unmount());
    }
});

it('Tauri: host poll tick drives polling through the gate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00Z'));
    mocks.initSessionTsv.mockResolvedValue(undefined);
    stubTemps();
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

    let tick: (() => void) | undefined;
    const unlisten = vi.fn();
    mocks.listen.mockImplementation((event: string, handler: () => void) => {
        if (event === 'sidecar-poll-tick') tick = handler;
        return Promise.resolve(unlisten);
    });

    const root = renderProbe(500);
    try {
        await flushReady();
        expect(mocks.listen).toHaveBeenCalledWith('sidecar-poll-tick', expect.any(Function));
        const initialPolls = mocks.getTemperatures.mock.calls.length;

        // 500ms 후 tick → 게이트 통과 → 폴링 1회 추가
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
            tick?.();
            await Promise.resolve();
        });
        expect(mocks.getTemperatures.mock.calls.length).toBe(initialPolls + 1);

        // 직후 burst tick은 게이트가 흡수
        await act(async () => {
            tick?.();
            await Promise.resolve();
        });
        expect(mocks.getTemperatures.mock.calls.length).toBe(initialPolls + 1);
    } finally {
        act(() => root.unmount());
    }
    expect(unlisten).toHaveBeenCalled();
});

it('Tauri: listen 실패 시 setInterval 폴백으로 폴링이 계속된다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00Z'));
    mocks.initSessionTsv.mockResolvedValue(undefined);
    stubTemps();
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mocks.listen.mockRejectedValue(new Error('ipc unavailable'));

    const root = renderProbe(500);
    try {
        await flushReady();
        const initialPolls = mocks.getTemperatures.mock.calls.length;

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        expect(mocks.getTemperatures.mock.calls.length).toBe(initialPolls + 3);
    } finally {
        act(() => root.unmount());
    }
});

it('waits for sidecar-ready / waitUntilReady before polling (same rule as Machines)', () => {
    expect(hookSrc).toContain("listen<null>('sidecar-ready'");
    expect(hookSrc).toContain('sidecar.waitUntilReady()');
    expect(hookSrc).toContain('if (!isActive || !sidecarReady) return');
    expect(hookSrc).toContain("if (phase === 'idle' || !sidecarReady) return");
});

it('does not poll until waitUntilReady resolves', async () => {
    let resolveReady = (_status: { connected: boolean }) => {};
    mocks.waitUntilReady.mockReturnValue(
        new Promise((resolve) => {
            resolveReady = resolve;
        }),
    );

    const setConnected = vi.fn();
    useRoastingStore.setState({ phase: 'idle' });
    const roastStartTimeRef = { current: 0 };
    const root = createRoot(document.createElement('div'));
    const Probe = () => {
        useSidecarPolling({
            isActive: true,
            phase: 'idle',
            pollIntervalMs: 60_000,
            enterPreheating: vi.fn(),
            setConnected,
            roastStartTimeRef,
            sessionId: null,
        });
        return null;
    };

    try {
        act(() => root.render(createElement(Probe)));
        await act(async () => {
            await Promise.resolve();
        });
        expect(mocks.getStatus).not.toHaveBeenCalled();
        expect(mocks.getTemperatures).not.toHaveBeenCalled();

        await act(async () => {
            resolveReady({ connected: false });
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(mocks.getStatus).toHaveBeenCalled());
        expect(mocks.getTemperatures).not.toHaveBeenCalled();
    } finally {
        await act(async () => {
            root.unmount();
        });
    }
});

it('does not promote poll unauthorized to disconnect', async () => {
    mocks.getTemperatures.mockRejectedValue(new Error('unauthorized'));
    mocks.getStatus.mockRejectedValue(new Error('unauthorized'));
    const setConnected = vi.fn();
    useRoastingStore.setState({ phase: 'roasting', sessionId: 'issue-380' });
    const roastStartTimeRef = { current: Date.now() - 1000 };
    const root = createRoot(document.createElement('div'));
    const Probe = () => {
        useSidecarPolling({
            isActive: true,
            phase: 'roasting',
            pollIntervalMs: 60_000,
            enterPreheating: vi.fn(),
            setConnected,
            roastStartTimeRef,
            sessionId: 'issue-380',
        });
        return null;
    };

    try {
        act(() => root.render(createElement(Probe)));
        await flushReady();
        await vi.waitFor(() => expect(mocks.getTemperatures).toHaveBeenCalled());
        expect(setConnected).not.toHaveBeenCalledWith(false);
    } finally {
        await act(async () => {
            root.unmount();
        });
    }
});

it.each([0, 3000])('seeds Charge BT at 00:00 before polling resolves (onset lag %i ms, #452)', async (lagMs) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
    mocks.initSessionTsv.mockResolvedValue(undefined);
    stubTemps();
    useRoastingStore.setState({ phase: 'standby', sessionId: 'bbp-433' });
    const roastStartTimeRef = { current: 0 };
    const root = createRoot(document.createElement('div'));
    let livePoints: ReturnType<typeof useSidecarPolling>['livePoints'] = [];

    const Probe = ({ phase }: { phase: string }) => {
        const r = useSidecarPolling({
            isActive: true,
            phase,
            pollIntervalMs: 500,
            enterPreheating: vi.fn(),
            setConnected: vi.fn(),
            roastStartTimeRef,
            sessionId: 'bbp-433',
            chargeBt: phase === 'roasting' ? 210.1 : null,
        });
        livePoints = r.livePoints;
        return null;
    };

    try {
        act(() => root.render(createElement(Probe, { phase: 'standby' })));
        await flushReady();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });
        expect(livePoints.length).toBeGreaterThan(0);

        // Hold the immediate Charge poll: the seed must exist without a new reading.
        const nextReading = await mocks.getTemperatures();
        let resolveReading = (_reading: unknown) => {};
        mocks.getTemperatures.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveReading = resolve;
            }),
        );
        roastStartTimeRef.current = Date.now() - lagMs;
        useRoastingStore.setState({ phase: 'roasting', sessionId: 'bbp-433' });
        act(() => root.render(createElement(Probe, { phase: 'roasting' })));
        expect(livePoints).toEqual([
            {
                time: 0,
                label: '0:00',
                bt: 210.1,
                et: 210,
                ror: null,
                ror_et: null,
                heater: 80,
                fan: 40,
                drum: 60,
                heaterSet: null,
            },
        ]);
        expect(mocks.enqueueTsvRow).toHaveBeenCalledWith('bbp-433', '0.00\t210.1\t210\t\t80\t40\t60\t\n');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
            resolveReading(nextReading);
        });
        expect(livePoints.map((point) => [point.time, point.bt])).toEqual([
            [0, 210.1],
            [lagMs / 1000 + 0.5, 200],
        ]);
        expect(mocks.enqueueTsvRow).toHaveBeenCalledTimes(2);
    } finally {
        act(() => root.unmount());
    }
});

it('publishes raw sample timestamps separately and clears stale or missing input', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));
    mocks.initSessionTsv.mockResolvedValue(undefined);
    const reading = {
        bt: 200,
        bt_raw: 198,
        timestamp: 10,
        stale: false,
        et: 210,
        ror: 5,
        ror_et: 4,
        heater: 80,
        fan: 40,
        drum: 60,
    };
    mocks.getTemperatures.mockImplementation(async () => ({ ...reading }));
    const root = renderProbe(1000);
    try {
        await flushReady();
        expect(useRoastingStore.getState().rawTemperature).toMatchObject({
            bt: 198,
            timestamp: 10,
            receivedAtMs: Date.now(),
        });
        reading.timestamp++;
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        // Even an unchanged integer reading must reach the detector as a new sample.
        expect(useRoastingStore.getState().rawTemperature?.timestamp).toBe(11);
        reading.bt_raw = 0;
        reading.timestamp++;
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(useRoastingStore.getState().rawTemperature?.bt).toBe(0); // detector validates range
        reading.bt_raw = 196;
        reading.timestamp++;
        reading.stale = true;
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(useRoastingStore.getState().rawTemperature).toBeNull();
        // An older sidecar's smoothed reading must never silently become raw BT.
        stubTemps();
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(useRoastingStore.getState().rawTemperature).toBeNull();
    } finally {
        act(() => root.unmount());
    }
});

it('serializes polls and clears raw input on HTTP failure, releasing the lock', async () => {
    vi.useFakeTimers();
    mocks.initSessionTsv.mockResolvedValue(undefined);
    let rejectRead = (_error: Error) => {};
    mocks.getTemperatures.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
            rejectRead = reject;
        }),
    );
    const root = renderProbe(500);
    try {
        await flushReady();
        await act(async () => vi.advanceTimersByTimeAsync(1500));
        expect(mocks.getTemperatures).toHaveBeenCalledTimes(1);
        useRoastingStore.getState().updateRawTemperature({ timestamp: 1, receivedAtMs: Date.now(), bt: 200 });
        await act(async () => rejectRead(new Error('timeout')));
        expect(useRoastingStore.getState().rawTemperature).toBeNull();
        stubTemps();
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(mocks.getTemperatures).toHaveBeenCalledTimes(2);
    } finally {
        act(() => root.unmount());
    }
});

it('drops an in-flight response from before sidecar-ready and resumes with fresh raw data', async () => {
    vi.useFakeTimers();
    mocks.initSessionTsv.mockResolvedValue(undefined);
    let ready = () => {};
    mocks.listen.mockImplementation(async (event: string, callback: () => void) => {
        if (event === 'sidecar-ready') ready = callback;
        return () => {};
    });
    let resolveRead = (_reading: unknown) => {};
    mocks.getTemperatures.mockReturnValueOnce(
        new Promise((resolve) => {
            resolveRead = resolve;
        }),
    );
    const root = renderProbe(500);
    const reading = { bt: 200, bt_raw: 199, timestamp: 1, et: null, ror: 0, ror_et: 0, heater: 0, fan: 0, drum: 0 };
    try {
        await flushReady();
        act(() => ready());
        await act(async () => resolveRead(reading));
        expect(useRoastingStore.getState().rawTemperature).toBeNull();
        mocks.getTemperatures.mockResolvedValue(reading);
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(useRoastingStore.getState().rawTemperature?.bt).toBe(199);
    } finally {
        act(() => root.unmount());
    }
});

it('publishes automatic Charge after standby work, initializes TSV then seeds exactly once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));
    mocks.initSessionTsv.mockResolvedValue(undefined);
    let count = 0;
    mocks.getTemperatures.mockImplementation(async () => {
        const i = count++;
        return {
            bt: 200,
            bt_raw: 200 - Math.max(0, i - 4),
            timestamp: i / 2,
            et: null,
            ror: 0,
            ror_et: 0,
            heater: 0,
            fan: 0,
            drum: 0,
        };
    });
    useRoastingStore.setState({ phase: 'standby', sidecarConnected: true });
    const roastStartTimeRef = { current: 0 };
    const root = createRoot(document.createElement('div'));
    let chargeBt: number | null = null;
    let points: ReturnType<typeof useSidecarPolling>['livePoints'] = [];
    const Probe = () => {
        const phase = useRoastingStore((state) => state.phase);
        const sessionId = useRoastingStore((state) => state.sessionId);
        const polling = useSidecarPolling({
            isActive: true,
            phase,
            pollIntervalMs: 500,
            enterPreheating: () => {},
            setConnected: useRoastingStore.getState().setConnected,
            roastStartTimeRef,
            sessionId,
            chargeBt,
        });
        points = polling.livePoints;
        useAutoDetection({
            livePoints: points,
            onAutoCharge: (bt, time) => {
                chargeBt = bt;
                roastStartTimeRef.current = time ?? Date.now();
                useRoastingStore.getState().startCharge(time);
            },
            onAutoDrop: () => {},
            onTurningPoint: () => {},
            autoChargeEnabled: true,
            autoChargeMode: 'standard',
            pollIntervalMs: 500,
            autoDropEnabled: true,
            autoDropMode: 'standard',
            yellowTempC: 150,
            unit: 'C',
            logEntries: [],
            autoYellowEnabled: true,
        });
        return null;
    };
    try {
        act(() => root.render(createElement(Probe)));
        await flushReady();
        for (let i = 0; i < 6; i++) await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(useRoastingStore.getState().charged).toBe(true);
        expect(points[0]).toMatchObject({ time: 0, bt: 200 });
        expect(points.filter((point) => point.time === 0)).toHaveLength(1);
        const rows = mocks.enqueueTsvRow.mock.calls;
        expect(rows.filter(([, row]) => row.startsWith('0.00\t200\t'))).toHaveLength(1);
        expect(mocks.initSessionTsv.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.enqueueTsvRow.mock.invocationCallOrder[0],
        );
    } finally {
        act(() => root.unmount());
    }
});

const reading = (over: Record<string, unknown> = {}) => ({
    bt: 200,
    bt_raw: 200,
    timestamp: 10,
    stale: false,
    reconnecting: false,
    et: 210,
    ror: 5,
    ror_et: 4,
    heater: 80,
    fan: 40,
    drum: 60,
    ...over,
});

const startMutablePoll = async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
    mocks.initSessionTsv.mockResolvedValue(undefined);
    const payload = reading();
    mocks.getTemperatures.mockImplementation(async () => ({ ...payload }));
    const root = renderProbe(1000);
    await flushReady();
    return { root, payload };
};

const withMutablePoll = async (
    run: (ctx: {
        payload: ReturnType<typeof reading>;
        display: ReturnType<typeof useRoastingStore.getState>['liveData'];
        lastValid: number | null | undefined;
    }) => Promise<void>,
) => {
    const { root, payload } = await startMutablePoll();
    try {
        await run({
            payload,
            display: useRoastingStore.getState().liveData,
            lastValid: useRoastingStore.getState().observation?.lastValidReceivedAtMs,
        });
    } finally {
        act(() => root.unmount());
    }
};

const captureSidecarReady = () => {
    let ready = () => {};
    mocks.listen.mockImplementation(async (event: string, callback: () => void) => {
        if (event === 'sidecar-ready') ready = callback;
        return () => {};
    });
    return () => ready();
};

const withSidecarReadyPoll = async (setup: () => void, run: (ready: () => void) => Promise<void>) => {
    vi.useFakeTimers();
    mocks.initSessionTsv.mockResolvedValue(undefined);
    const ready = captureSidecarReady();
    setup();
    const root = renderProbe(500);
    try {
        await flushReady();
        await run(ready);
    } finally {
        act(() => root.unmount());
    }
};

it('refreshes last-valid time for a flat BT with a new device timestamp', async () => {
    await withMutablePoll(async ({ payload, display, lastValid }) => {
        expect(useRoastingStore.getState().observation).toMatchObject({
            quality: 'valid',
            isNew: true,
            lastValidDeviceTimestamp: 10,
        });
        payload.timestamp = 11;
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        const second = useRoastingStore.getState();
        expect(second.liveData).toBe(display);
        expect(second.observation).toMatchObject({ quality: 'valid', isNew: true, lastValidDeviceTimestamp: 11 });
        expect(second.observation?.lastValidReceivedAtMs).toBeGreaterThan(lastValid ?? 0);
    });
});

it('updates quality when only stale changes and keeps the same display object', async () => {
    await withMutablePoll(async ({ payload, display, lastValid }) => {
        payload.stale = true;
        payload.timestamp = 11;
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        const next = useRoastingStore.getState();
        expect(next.liveData).toBe(display);
        expect(next.observation?.quality).toBe('stale');
        expect(next.observation?.isNew).toBe(false);
        expect(next.observation?.lastValidReceivedAtMs).toBe(lastValid);
    });
});

it('keeps the last display value and marks spike rejects invalid', async () => {
    await withMutablePoll(async ({ payload, display, lastValid }) => {
        payload.bt = 1372;
        payload.bt_raw = 1372;
        payload.timestamp = 11;
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        const next = useRoastingStore.getState();
        expect(next.liveData).toBe(display);
        expect(next.liveData?.bt).toBe(200);
        expect(next.observation?.quality).toBe('spike');
        expect(next.observation?.lastValidReceivedAtMs).toBe(lastValid);
    });
});

it('does not treat a repeated device timestamp as a new observation', async () => {
    await withMutablePoll(async ({ lastValid }) => {
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        const next = useRoastingStore.getState();
        expect(next.observation?.quality).toBe('retransmit');
        expect(next.observation?.isNew).toBe(false);
        expect(next.observation?.lastValidReceivedAtMs).toBe(lastValid);
    });
});

it('does not apply an in-flight observation from a previous sidecar generation', async () => {
    let resolveRead = (_reading: unknown) => {};
    await withSidecarReadyPoll(
        () => {
            mocks.getTemperatures.mockReturnValueOnce(
                new Promise((resolve) => {
                    resolveRead = resolve;
                }),
            );
        },
        async (ready) => {
            act(() => ready());
            await act(async () => resolveRead(reading({ timestamp: 1, bt: 199, bt_raw: 199 })));
            expect(useRoastingStore.getState().observation).toBeNull();
            mocks.getTemperatures.mockResolvedValue(reading({ timestamp: 2, bt: 198, bt_raw: 198 }));
            await act(async () => vi.advanceTimersByTimeAsync(500));
            expect(useRoastingStore.getState().observation).toMatchObject({
                quality: 'valid',
                lastValidDeviceTimestamp: 2,
            });
        },
    );
});

it('resets the BT filter on sidecar-ready so prior device samples are not inherited', async () => {
    await withSidecarReadyPoll(
        () => {
            mocks.getTemperatures.mockResolvedValue(reading({ timestamp: 1, bt: 200, bt_raw: 200 }));
        },
        async (ready) => {
            expect(useRoastingStore.getState().liveData?.bt).toBe(200);
            act(() => ready());
            mocks.getTemperatures.mockResolvedValue(reading({ timestamp: 2, bt: 50, bt_raw: 50 }));
            await act(async () => vi.advanceTimersByTimeAsync(500));
            expect(useRoastingStore.getState().liveData?.bt).toBe(50);
            expect(useRoastingStore.getState().observation).toMatchObject({
                quality: 'valid',
                lastValidDeviceTimestamp: 2,
            });
        },
    );
});

it('does not refresh last-valid time on poll error or null BT', async () => {
    await withMutablePoll(async ({ lastValid }) => {
        mocks.getTemperatures.mockRejectedValueOnce(new Error('timeout'));
        mocks.getStatus.mockResolvedValue({ connected: true, reconnecting: true });
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(useRoastingStore.getState().observation?.quality).toBe('poll_error');
        expect(useRoastingStore.getState().observation?.lastValidReceivedAtMs).toBe(lastValid);
        mocks.getTemperatures.mockResolvedValue(reading({ bt: null, bt_raw: null, timestamp: 12 }));
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(useRoastingStore.getState().observation?.quality).toBe('null');
        expect(useRoastingStore.getState().observation?.lastValidReceivedAtMs).toBe(lastValid);
    });
});

const flushPendingPoll = async () => {
    await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
};

const holdStatus = () => {
    let resolve = (_status: { connected: boolean; reconnecting?: boolean }) => {};
    mocks.getStatus.mockImplementationOnce(
        () =>
            new Promise((r) => {
                resolve = r;
            }),
    );
    return (status: { connected: boolean; reconnecting?: boolean }) => resolve(status);
};

it.each([
    {
        name: 'null BT',
        arrange: () => mocks.getTemperatures.mockResolvedValueOnce(reading({ bt: null, bt_raw: null, timestamp: 12 })),
        quality: 'null' as const,
    },
    {
        name: 'temperature reject',
        arrange: () => mocks.getTemperatures.mockRejectedValueOnce(new Error('timeout')),
        quality: 'poll_error' as const,
    },
])('publishes $quality while getStatus is still pending ($name)', async ({ arrange, quality }) => {
    await withMutablePoll(async ({ lastValid }) => {
        arrange();
        const finishStatus = holdStatus();
        await flushPendingPoll();
        expect(useRoastingStore.getState().observation?.quality).toBe(quality);
        expect(useRoastingStore.getState().observation?.lastValidReceivedAtMs).toBe(lastValid);
        await act(async () => {
            finishStatus({ connected: true, reconnecting: true });
            await Promise.resolve();
        });
        expect(useRoastingStore.getState().observation?.quality).toBe(quality);
        expect(useRoastingStore.getState().observation?.lastValidReceivedAtMs).toBe(lastValid);
    });
});

it('does not keep valid quality after an unauthorized temperature poll', async () => {
    await withMutablePoll(async ({ lastValid }) => {
        const statusCalls = mocks.getStatus.mock.calls.length;
        mocks.getTemperatures.mockRejectedValueOnce(new Error('unauthorized'));
        await flushPendingPoll();
        expect(useRoastingStore.getState().observation?.quality).toBe('poll_error');
        expect(useRoastingStore.getState().observation?.lastValidReceivedAtMs).toBe(lastValid);
        expect(mocks.getStatus).toHaveBeenCalledTimes(statusCalls);
    });
});

it('does not apply a late poll error from a previous sidecar generation', async () => {
    let rejectRead = (_error: Error) => {};
    let resolveStatus = (_status: { connected: boolean }) => {};
    await withSidecarReadyPoll(
        () => {
            mocks.getTemperatures.mockReturnValueOnce(
                new Promise((_resolve, reject) => {
                    rejectRead = reject;
                }),
            );
            mocks.getStatus.mockReturnValue(
                new Promise((resolve) => {
                    resolveStatus = resolve;
                }),
            );
        },
        async (ready) => {
            act(() => ready());
            await act(async () => rejectRead(new Error('timeout')));
            expect(useRoastingStore.getState().observation).toBeNull();
            await act(async () => {
                resolveStatus({ connected: true });
                await Promise.resolve();
            });
            expect(useRoastingStore.getState().observation).toBeNull();
        },
    );
});

it('ignores the old phase response even before React runs polling cleanup', async () => {
    mocks.initSessionTsv.mockResolvedValue(undefined);
    let resolveRead = (_reading: unknown) => {};
    mocks.getTemperatures.mockReturnValueOnce(
        new Promise((resolve) => {
            resolveRead = resolve;
        }),
    );
    const root = renderProbe(500);
    try {
        await flushReady();
        useRoastingStore.setState({ phase: 'standby' });
        await act(async () => resolveRead({ bt: 200, bt_raw: 200, timestamp: 1 }));
        expect(useRoastingStore.getState().rawTemperature).toBeNull();
        expect(mocks.enqueueTsvRow).not.toHaveBeenCalled();
    } finally {
        act(() => root.unmount());
    }
});
