// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildControlLiveReadout,
    CONTROL_STALE_AGE_FACTOR,
    type ControlLiveInput,
    controlLinkState,
} from './control-readout';
import { CONTROL_STALE_TIMER_MARGIN_MS, useControlReadoutNowMs } from './useControlReadoutNowMs';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const liveInput = (over: Partial<ControlLiveInput> = {}): ControlLiveInput => ({
    liveData: { heater: 50, fan: 0, drum: 0 },
    capabilities: ['heater'],
    connected: true,
    reconnecting: false,
    quality: 'valid',
    pollIntervalMs: 1000,
    ...over,
});

describe('useControlReadoutNowMs', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    it('does not schedule when disconnected', () => {
        const Probe = () => {
            useControlReadoutNowMs({
                connected: false,
                isActive: true,
                lastValidReceivedAtMs: Date.now(),
                pollIntervalMs: 1000,
            });
            return null;
        };
        act(() => {
            root.render(createElement(Probe));
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('flips buildControlLiveReadout to stale past the strict boundary and re-arms after a new reading', () => {
        const poll = 1000;
        const last = Date.now();
        const staleAt = last + CONTROL_STALE_AGE_FACTOR * poll;

        expect(
            controlLinkState({
                connected: true,
                reconnecting: false,
                quality: 'valid',
                lastValidReceivedAtMs: last,
                pollIntervalMs: poll,
                nowMs: staleAt,
            }),
        ).toBe('live');

        let lastProp = last;
        let nowMs = last;
        const Probe = () => {
            nowMs = useControlReadoutNowMs({
                connected: true,
                isActive: true,
                lastValidReceivedAtMs: lastProp,
                pollIntervalMs: poll,
            });
            return null;
        };

        act(() => {
            root.render(createElement(Probe));
        });
        expect(vi.getTimerCount()).toBe(1);

        act(() => {
            vi.advanceTimersByTime(CONTROL_STALE_AGE_FACTOR * poll + CONTROL_STALE_TIMER_MARGIN_MS);
        });

        expect(
            buildControlLiveReadout({
                ...liveInput(),
                lastValidReceivedAtMs: lastProp,
                nowMs,
                pollIntervalMs: poll,
            }).state,
        ).toBe('stale');
        expect(vi.getTimerCount()).toBe(0);

        const freshAt = staleAt + CONTROL_STALE_TIMER_MARGIN_MS + 50;
        act(() => {
            vi.setSystemTime(freshAt);
            lastProp = freshAt;
            root.render(createElement(Probe));
        });

        expect(
            buildControlLiveReadout({
                ...liveInput(),
                lastValidReceivedAtMs: lastProp,
                nowMs,
                pollIntervalMs: poll,
            }).state,
        ).toBe('live');
        expect(vi.getTimerCount()).toBe(1);

        act(() => {
            vi.advanceTimersByTime(CONTROL_STALE_AGE_FACTOR * poll + CONTROL_STALE_TIMER_MARGIN_MS);
        });
        expect(
            buildControlLiveReadout({
                ...liveInput(),
                lastValidReceivedAtMs: lastProp,
                nowMs,
                pollIntervalMs: poll,
            }).state,
        ).toBe('stale');
    });

    it('re-arms exactly one timeout when the first fire is still inside the strict stale window', () => {
        const poll = 1000;
        const last = Date.now();

        let nowMs = last;
        const Probe = () => {
            nowMs = useControlReadoutNowMs({
                connected: true,
                isActive: true,
                lastValidReceivedAtMs: last,
                pollIntervalMs: poll,
            });
            return null;
        };

        act(() => {
            root.render(createElement(Probe));
        });
        expect(vi.getTimerCount()).toBe(1);

        act(() => {
            vi.advanceTimersByTime(CONTROL_STALE_AGE_FACTOR * poll);
        });
        act(() => {
            vi.setSystemTime(last);
        });
        act(() => {
            vi.advanceTimersByTime(CONTROL_STALE_TIMER_MARGIN_MS);
        });

        expect(
            buildControlLiveReadout({
                ...liveInput(),
                lastValidReceivedAtMs: last,
                nowMs,
                pollIntervalMs: poll,
            }).state,
        ).toBe('live');
        expect(vi.getTimerCount()).toBe(1);

        act(() => {
            vi.advanceTimersByTime(CONTROL_STALE_AGE_FACTOR * poll + CONTROL_STALE_TIMER_MARGIN_MS);
        });
        expect(
            buildControlLiveReadout({
                ...liveInput(),
                lastValidReceivedAtMs: last,
                nowMs,
                pollIntervalMs: poll,
            }).state,
        ).toBe('stale');
        expect(vi.getTimerCount()).toBe(0);
    });
});
