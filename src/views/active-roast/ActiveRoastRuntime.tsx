import { useRoastingStore } from '@features/active-roast/model/status';
import { useEffectivePollIntervalMs } from '@features/active-roast/model/useEffectivePollInterval';
import { useEffect } from 'react';
import { useRoastCloseGuard } from './model/useRoastCloseGuard';
import { useSidecarPolling } from './model/useSidecarPolling';

/** Keep collection alive while the roast screen's error boundary recovers. */
export const ActiveRoastRuntime = ({ isActive }: { isActive: boolean }) => {
    useRoastCloseGuard();
    const phase = useRoastingStore((state) => state.phase);
    const sessionId = useRoastingStore((state) => state.sessionId);
    const tick = useRoastingStore((state) => state.tick);
    const chargeBt = useRoastingStore(
        (state) => state.logState.entries.find((entry) => entry.event === 'Charge')?.tempC ?? null,
    );
    const pollIntervalMs = useEffectivePollIntervalMs();
    const { enterPreheating, setConnected } = useRoastingStore.getState();

    useSidecarPolling({ isActive, phase, sessionId, chargeBt, pollIntervalMs, enterPreheating, setConnected });
    useEffect(() => {
        if (phase !== 'roasting') return;
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [phase, tick]);
    return null;
};
