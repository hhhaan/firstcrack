// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_STALE_AGE_FACTOR } from './control-readout';
import { useControlReadoutNowMs } from './useControlReadoutNowMs';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

    it('schedules a single timeout at the stale boundary, not a 1s interval', () => {
        const poll = 1000;
        const last = Date.now() - 500;
        let latest = 0;
        const Probe = () => {
            latest = useControlReadoutNowMs({
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
        const before = latest;
        act(() => {
            vi.advanceTimersByTime(CONTROL_STALE_AGE_FACTOR * poll - 500);
        });
        expect(latest).toBeGreaterThanOrEqual(before);
        expect(vi.getTimerCount()).toBe(0);
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
});
