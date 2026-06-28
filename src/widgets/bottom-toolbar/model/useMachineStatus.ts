import type { SidecarStatus } from '@entities/machine';
import { useState } from 'react';

export interface MachineStatus {
    connected: boolean;
    displayName: string;
    reconnecting: boolean;
    error: string | null;
}

// ponytail: polling disabled — re-enable when BottomToolbar is activated
export const useMachineStatus = (_pollIntervalMs = 5000): MachineStatus => {
    const [status] = useState<SidecarStatus | null>(null);

    // ponytail: polling useEffect removed to prevent dead 5s polling loop.
    // When BottomToolbar is re-enabled in App.tsx, uncomment the useEffect below
    // and rename _pollIntervalMs → pollIntervalMs:
    // useEffect(() => {
    //     let cancelled = false;
    //     const poll = async () => {
    //         try {
    //             const next = await sidecar.getStatus();
    //             if (cancelled) return;
    //             setStatus((prev) => (isSameSidecarStatus(prev, next) ? prev : next));
    //         } catch {
    //             if (cancelled) return;
    //             setStatus(null);
    //         }
    //     };
    //     poll();
    //     const id = setInterval(poll, _pollIntervalMs);
    //     return () => {
    //         cancelled = true;
    //         clearInterval(id);
    //     };
    // }, [_pollIntervalMs]);

    return {
        connected: status?.connected ?? false,
        displayName: status?.display_name ?? '',
        reconnecting: status?.reconnecting ?? false,
        error: status?.error ?? null,
    };
};
