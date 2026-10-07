import { useEffect, useState } from 'react';
import { CONTROL_STALE_AGE_FACTOR } from './control-readout';

/** Wall clock for readout freshness only — updates at the stale boundary, not every second. */
export const useControlReadoutNowMs = (input: {
    connected: boolean;
    isActive: boolean;
    lastValidReceivedAtMs: number | null | undefined;
    pollIntervalMs: number;
}) => {
    const [nowMs, setNowMs] = useState(() => Date.now());
    useEffect(() => {
        if (!input.connected || !input.isActive || input.lastValidReceivedAtMs == null) return;
        const staleAt = input.lastValidReceivedAtMs + CONTROL_STALE_AGE_FACTOR * input.pollIntervalMs;
        const delay = Math.max(0, staleAt - Date.now());
        const id = setTimeout(() => setNowMs(Date.now()), delay);
        return () => clearTimeout(id);
    }, [input.connected, input.isActive, input.lastValidReceivedAtMs, input.pollIntervalMs]);
    return nowMs;
};
