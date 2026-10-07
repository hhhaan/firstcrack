import { useEffect, useState } from 'react';
import { CONTROL_STALE_AGE_FACTOR } from './control-readout';

/** Fires after the strict stale threshold so `controlLinkState` sees `now - last > 3×poll`. */
export const CONTROL_STALE_TIMER_MARGIN_MS = 1;

const isStaleAt = (lastValidReceivedAtMs: number, pollIntervalMs: number, nowMs: number) =>
    nowMs - lastValidReceivedAtMs > CONTROL_STALE_AGE_FACTOR * pollIntervalMs;

/** Wall clock for readout freshness only — single timeout at stale (+ margin), re-armed if still live. */
export const useControlReadoutNowMs = (input: {
    connected: boolean;
    isActive: boolean;
    lastValidReceivedAtMs: number | null | undefined;
    pollIntervalMs: number;
}) => {
    const [nowMs, setNowMs] = useState(() => Date.now());
    useEffect(() => {
        if (!input.connected || !input.isActive || input.lastValidReceivedAtMs == null) return;
        const last = input.lastValidReceivedAtMs;
        const poll = input.pollIntervalMs;
        let timeoutId: ReturnType<typeof setTimeout>;

        const schedule = () => {
            const staleAt = last + CONTROL_STALE_AGE_FACTOR * poll;
            const target = staleAt + CONTROL_STALE_TIMER_MARGIN_MS;
            const delay = Math.max(0, target - Date.now());
            timeoutId = setTimeout(() => {
                const now = Date.now();
                setNowMs(now);
                if (!isStaleAt(last, poll, now)) schedule();
            }, delay);
        };

        schedule();
        return () => clearTimeout(timeoutId);
    }, [input.connected, input.isActive, input.lastValidReceivedAtMs, input.pollIntervalMs]);
    return nowMs;
};
