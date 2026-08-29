// @vitest-environment jsdom
import { useRoastingStore } from '@features/active-roast/model/status';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useSidecarPolling } from './useSidecarPolling';

const mocks = vi.hoisted(() => ({
    enqueueTsvRow: vi.fn(),
    initSessionTsv: vi.fn(),
    getTemperatures: vi.fn(),
}));

vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        getTemperatures: mocks.getTemperatures,
        getStatus: vi.fn().mockResolvedValue({ connected: true }),
    },
}));

vi.mock('@shared/lib/tsv-writer', () => ({
    enqueueTsvRow: mocks.enqueueTsvRow,
    initSessionTsv: mocks.initSessionTsv,
    writeBbpTsv: vi.fn(),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    useRoastingStore.getState().reset();
});

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

        expect(mocks.enqueueTsvRow).toHaveBeenCalledOnce();
        const [sessionId, row] = mocks.enqueueTsvRow.mock.calls[0];
        expect(sessionId).toBe('issue-315');
        expect(row).toMatch(/\t80\t40\t60\n$/);
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
            preChargeDisplaySec: 30,
        });
        return null;
    };

    try {
        act(() => root.render(createElement(Probe)));
        await act(async () => {
            await Promise.resolve();
        });
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
