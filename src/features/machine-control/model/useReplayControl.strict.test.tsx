// @vitest-environment jsdom
import * as Sentry from '@sentry/react';
import { buildSentryOptions } from '@shared/lib/sentry';
import { act, createElement, type ReactElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { createSentryMemoryTransport } from '../lib/controlDiagnostics.fixtures';
import type { ReplayPoint } from '../lib/replay';
import { type ReplayControlInputs, useReplayControl } from './useReplayControl';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const POINTS: ReplayPoint[] = [
    { t: 0, bt: 180, heaterSet: 80 },
    { t: 60, bt: 95, heaterSet: 60 },
    { t: 300, bt: 155, heaterSet: 40 },
];

const BASE: Omit<ReplayControlInputs, 'writeHeater' | 'cancelUnsentHeater'> = {
    referencePoints: POINTS,
    referenceMachineMismatch: false,
    referenceDropTime: 600,
    liveBt: 180,
    elapsed: 30,
    roasting: true,
    confirmedTurningPoint: null,
    heaterWritable: true,
    pidEngaged: false,
    roastFinished: false,
    sidecarConnected: true,
    safeOffUnacknowledged: false,
    dropBehavior: 'hold',
    reconnecting: false,
    observationQuality: 'valid',
    lastValidReceivedAtMs: 1_000,
    nowMs: 1_500,
};

const mount = (probe: ReactElement) => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(probe));
    return () => act(() => root.unmount());
};

describe('useReplayControl render loop', () => {
    it('reports each committed timing stop once under StrictMode, including after resume', async () => {
        const events: Sentry.Event[] = [];
        Sentry.init({
            ...buildSentryOptions(),
            transport: () => createSentryMemoryTransport(events),
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const writeHeater = vi.fn(async (value: number) => value);
        const cancelUnsentHeater = vi.fn();
        let latest!: ReturnType<typeof useReplayControl>;
        const Probe = ({ elapsed }: { elapsed: number }) => {
            latest = useReplayControl({ ...BASE, sessionId: 'batch-1', elapsed, writeHeater, cancelUnsentHeater });
            return null;
        };
        const root = createRoot(document.createElement('div'));
        const render = (elapsed: number) =>
            act(async () => root.render(createElement(StrictMode, null, createElement(Probe, { elapsed }))));
        try {
            await render(30);
            await act(async () => latest.toggle());
            await render(36);
            await Sentry.flush(2000);
            expect(latest.stopReason).toBe('timingGap');
            expect(events).toHaveLength(1);
            expect(events[0].fingerprint).toEqual(['replay-stopped', 'timingGap']);
            expect(events[0].extra).toMatchObject({
                sessionId: 'batch-1',
                reason: 'timingGap',
                elapsed: 36,
                firedCount: 1,
            });
            await render(37);
            await Sentry.flush(2000);
            expect(events).toHaveLength(1);
            await act(async () => latest.toggle());
            await render(43);
            await Sentry.flush(2000);
            expect(latest.stopReason).toBe('timingGap');
            expect(events).toHaveLength(2);
            expect(writeHeater).toHaveBeenCalledTimes(2);
        } finally {
            act(() => root.unmount());
            await Sentry.close();
            consoleError.mockRestore();
        }
    });

    it('does not loop under StrictMode with a stable reference curve', () => {
        const writeHeater = vi.fn(async (value: number) => value);
        const cancelUnsentHeater = vi.fn();
        const Probe = () => {
            useReplayControl({ ...BASE, writeHeater, cancelUnsentHeater });
            return null;
        };
        const unmount = mount(createElement(StrictMode, null, createElement(Probe)));
        unmount();
    });

    it('does not loop when the parent rebuilds the same curve every render', () => {
        const writeHeater = vi.fn(async (value: number) => value);
        const cancelUnsentHeater = vi.fn();
        const Probe = () => {
            const referencePoints = POINTS.map((point) => ({ ...point }));
            useReplayControl({ ...BASE, referencePoints, writeHeater, cancelUnsentHeater });
            return null;
        };
        expect(() => mount(createElement(Probe))).not.toThrow();
    });

    it('does not loop when elapsed is NaN', () => {
        const writeHeater = vi.fn(async (value: number) => value);
        const cancelUnsentHeater = vi.fn();
        const Probe = () => {
            useReplayControl({ ...BASE, elapsed: Number.NaN, writeHeater, cancelUnsentHeater });
            return null;
        };
        expect(() => mount(createElement(Probe))).not.toThrow();
    });
});
