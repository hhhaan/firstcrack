import { logger } from '@shared/lib/logger';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import { useRoastingStore } from './status';

export function useRoastMonitorVisibility() {
    const enabled = useRoastingStore(
        (state) =>
            state.sidecarConnected || state.reconnecting || state.phase === 'roasting' || state.phase === 'ended',
    );
    const pending = useRef<Promise<void> | null>(null);
    // oxlint-disable-next-line react-doctor/effect-needs-cleanup -- Conditional polling is cleared below; disconnect and unmount tests cover both branches.
    useEffect(() => {
        if (!isTauri()) return;
        let disposed = false;
        let reported = false;
        const sync = () => {
            pending.current = (pending.current ?? Promise.resolve()).then(async () => {
                try {
                    await invoke('sync_roast_monitor', { enabled: !disposed && enabled });
                    reported = false;
                } catch (error) {
                    if (!reported) logger.capture(error, { feature: 'roast-monitor' });
                    reported = true;
                }
            });
        };
        sync();
        const timer = enabled ? setInterval(sync, 1000) : undefined;
        return () => {
            disposed = true;
            clearInterval(timer);
            sync();
        };
    }, [enabled]);
}
