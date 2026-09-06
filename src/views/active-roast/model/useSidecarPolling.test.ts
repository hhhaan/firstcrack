// @vitest-environment jsdom
import { useRoastingStore } from '@features/active-roast/model/status';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useSidecarPolling } from './useSidecarPolling';

const mocks = vi.hoisted(() => ({
    getTemperatures: vi.fn(),
    startSession: vi.fn().mockResolvedValue({ ok: true }),
    listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: mocks.listen,
}));

vi.mock('@shared/lib/sidecar', () => ({
    buildSidecarSessionStart: vi.fn(async (sessionId: string, chargeEpochMs: number) => ({
        session_id: sessionId,
        charge_epoch_ms: chargeEpochMs,
    })),
    sidecar: {
        getTemperatures: mocks.getTemperatures,
        getStatus: vi.fn().mockResolvedValue({ connected: true }),
        startSession: mocks.startSession,
        stopSession: vi.fn().mockResolvedValue({ ok: true }),
    },
}));

vi.mock('@shared/lib/tsv-writer', () => ({
    writeBbpTsv: vi.fn(),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    useRoastingStore.getState().reset();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

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
            preChargeDisplaySec: 30,
        });
        return null;
    };
    act(() => root.render(createElement(Probe)));
    return root;
};

it('starts sidecar session recorder on first roast sample, does not write TSV in the webview', async () => {
    mocks.getTemperatures.mockResolvedValue({
        bt: 200,
        et: 210,
        ror: 5,
        ror_et: 4,
        heater: 80,
        fan: 40,
        drum: 60,
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
            preChargeDisplaySec: 30,
        });
        return null;
    };

    try {
        act(() => root.render(createElement(StrictMode, null, createElement(Probe))));
        await act(async () => {
            await vi.waitFor(() => expect(mocks.getTemperatures).toHaveBeenCalled());
        });
        await act(async () => {
            await vi.waitFor(() => expect(mocks.startSession).toHaveBeenCalled());
        });
        expect(mocks.startSession).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'issue-315' }));
    } finally {
        await act(async () => {
            root.unmount();
        });
    }
});

it('accepts the first sample when roast-relative time moves backwards for a new batch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T12:00:00Z'));
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
            preChargeDisplaySec: 30,
        });
        return null;
    };

    try {
        act(() => root.render(createElement(Probe)));
        await act(async () => {
            await Promise.resolve();
        });
        expect(mocks.getTemperatures).toHaveBeenCalledOnce();

        roastStartTimeRef.current = Date.now();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });

        expect(mocks.getTemperatures).toHaveBeenCalledTimes(2);
    } finally {
        act(() => root.unmount());
    }
});

it('Tauri: host poll tick drives polling through the gate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00Z'));
    stubTemps();
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

    let tick: (() => void) | undefined;
    const unlisten = vi.fn();
    mocks.listen.mockImplementation((_event: string, handler: () => void) => {
        tick = handler;
        return Promise.resolve(unlisten);
    });

    const root = renderProbe(500);
    try {
        await act(async () => {
            await Promise.resolve();
        });
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
    stubTemps();
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mocks.listen.mockRejectedValue(new Error('ipc unavailable'));

    const root = renderProbe(500);
    try {
        await act(async () => {
            await Promise.resolve();
        });
        const initialPolls = mocks.getTemperatures.mock.calls.length;

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        expect(mocks.getTemperatures.mock.calls.length).toBe(initialPolls + 3);
    } finally {
        act(() => root.unmount());
    }
});
