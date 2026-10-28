import { logger } from '@shared/lib/logger';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useLayoutEffect, useRef } from 'react';
import {
    MONITOR_REQUEST,
    MONITOR_SNAPSHOT,
    MONITOR_TIMEOUT_MS,
    type MonitorSnapshot,
    monitorRequestSchema,
} from '../lib/roast-monitor';
import { useRoastingStore } from './status';
import { useRoastMonitorVisibility } from './useRoastMonitorVisibility';

export function useRoastMonitorBridge({
    snapshot,
    onDrop,
    onShowMain,
}: {
    snapshot: MonitorSnapshot;
    onDrop: () => void;
    onShowMain: () => void;
}) {
    const latest = useRef({ snapshot, onDrop, onShowMain });
    useRoastMonitorVisibility();
    useLayoutEffect(() => {
        latest.current = { snapshot, onDrop, onShowMain };
    }, [snapshot, onDrop, onShowMain]);

    // oxlint-disable-next-line react-doctor/effect-needs-cleanup -- Async Tauri unlisten runs on teardown or late resolution; covered by the unmount test.
    useEffect(() => {
        if (!isTauri()) return;
        let disposed = false;
        let unlisten: (() => void) | undefined;
        void getCurrentWindow()
            .listen<unknown>(MONITOR_REQUEST, ({ payload }) => {
                if (disposed) return;
                const request = monitorRequestSchema.safeParse(payload);
                if (!request.success) return;
                const current = latest.current;
                const state = useRoastingStore.getState();
                const sampledAt = state.liveData?.receivedAtMs;
                const stale =
                    current.snapshot.stale || (sampledAt != null && Date.now() - sampledAt >= MONITOR_TIMEOUT_MS);
                if (request.data.type === 'drop') {
                    if (
                        current.snapshot.canDrop &&
                        current.snapshot.connected &&
                        !stale &&
                        current.snapshot.sessionId === request.data.sessionId &&
                        state.phase === 'roasting' &&
                        state.sessionId === request.data.sessionId
                    ) {
                        try {
                            current.onDrop();
                        } catch (error) {
                            logger.capture(error, { feature: 'roast-monitor' });
                        }
                    }
                } else if (request.data.type === 'show-main') {
                    current.onShowMain();
                    void invoke('show_roast_main').catch((error) => {
                        logger.capture(error, { feature: 'roast-monitor' });
                    });
                }
                const after = useRoastingStore.getState();
                void emitTo('roast-monitor', MONITOR_SNAPSHOT, {
                    ...latest.current.snapshot,
                    stale,
                    canDrop:
                        latest.current.snapshot.canDrop &&
                        after.phase === 'roasting' &&
                        after.sessionId === latest.current.snapshot.sessionId,
                }).catch(() => undefined);
            })
            .then((stop) => {
                if (disposed) stop();
                else unlisten = stop;
            })
            .catch((error) => logger.capture(error, { feature: 'roast-monitor' }));
        return () => {
            disposed = true;
            if (unlisten) unlisten();
        };
    }, []);
}
