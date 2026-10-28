import { i18n } from '@shared/i18n';
import { logger } from '@shared/lib/logger';
import { isTauri } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import {
    MONITOR_REQUEST,
    MONITOR_SNAPSHOT,
    MONITOR_TIMEOUT_MS,
    type MonitorRequest,
    type MonitorSnapshot,
    monitorSnapshotSchema,
} from '../lib/roast-monitor';

export function useRoastMonitor() {
    const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
    const [fresh, setFresh] = useState(false);
    const [pending, setPending] = useState(false);
    const [failed, setFailed] = useState(false);
    const receivedAt = useRef<number | null>(null);
    const sending = useRef(false);

    const request = async (message: MonitorRequest) => {
        try {
            await emitTo('main', MONITOR_REQUEST, message);
        } catch (error) {
            setFailed(true);
            sending.current = false;
            setPending(false);
            logger.capture(error, { feature: 'roast-monitor' });
        }
    };

    // oxlint-disable-next-line react-doctor/effect-needs-cleanup -- Async Tauri unlisten and the timer are released below; covered by the unmount test.
    useEffect(() => {
        if (!isTauri()) return;
        let disposed = false;
        let unlisten: (() => void) | undefined;
        let timer: ReturnType<typeof setInterval> | undefined;
        void getCurrentWindow()
            .listen<unknown>(MONITOR_SNAPSHOT, ({ payload }) => {
                if (disposed) return;
                const result = monitorSnapshotSchema.safeParse(payload);
                if (!result.success) return;
                receivedAt.current = Date.now();
                setSnapshot(result.data);
                setFresh(true);
                setFailed(false);
                sending.current = false;
                setPending(false);
                if (i18n.language !== result.data.language) {
                    void i18n.changeLanguage(result.data.language);
                    document.documentElement.lang = result.data.language;
                }
            })
            .then((stop) => {
                if (disposed) {
                    stop();
                    return;
                }
                unlisten = stop;
                const sync = () => {
                    if (receivedAt.current == null || Date.now() - receivedAt.current >= MONITOR_TIMEOUT_MS) {
                        setFresh(false);
                        sending.current = false;
                        setPending(false);
                    }
                    // A missing heartbeat is shown inline; it is not a per-second failure report.
                    void emitTo('main', MONITOR_REQUEST, { type: 'sync' }).catch(() => setFresh(false));
                };
                sync();
                timer = setInterval(sync, 1000);
            })
            .catch((error) => {
                setFailed(true);
                logger.capture(error, { feature: 'roast-monitor' });
            });
        return () => {
            disposed = true;
            if (unlisten) unlisten();
            clearInterval(timer);
        };
    }, []);

    const drop = () => {
        if (
            !fresh ||
            !snapshot?.canDrop ||
            !snapshot.connected ||
            snapshot.stale ||
            !snapshot.sessionId ||
            sending.current
        )
            return;
        sending.current = true;
        setPending(true);
        void request({ type: 'drop', sessionId: snapshot.sessionId });
    };

    return { snapshot, fresh, pending, failed, drop, showMain: () => void request({ type: 'show-main' }) };
}
