import { sidecar } from '@shared/lib/sidecar';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';
import { isSidecarProcessHealthy, nextSidecarDeadState } from '../lib/sidecarDead';

const HEALTH_POLL_MS = 3000;

export const useSidecarDeadListener = (): { isDead: boolean; relaunch: () => void } => {
    const [isDead, setIsDead] = useState(false);

    useEffect(() => {
        let unlisten: (() => void) | undefined;

        void listen<null>('sidecar-dead', () => {
            setIsDead((prev) => nextSidecarDeadState({ isDead: prev, event: 'sidecar-dead' }));
        }).then((fn) => {
            unlisten = fn;
        });

        return () => unlisten?.();
    }, []);

    useEffect(() => {
        if (!isDead) return;
        let cancelled = false;

        const check = async () => {
            try {
                const status = await sidecar.getStatus();
                if (cancelled) return;
                const event = isSidecarProcessHealthy(status) ? 'status-healthy' : 'status-failed';
                setIsDead((prev) => nextSidecarDeadState({ isDead: prev, event }));
            } catch {
                if (cancelled) return;
                setIsDead((prev) => nextSidecarDeadState({ isDead: prev, event: 'status-failed' }));
            }
        };

        void check();
        const id = setInterval(() => void check(), HEALTH_POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [isDead]);

    const relaunch = useCallback(() => {
        void invoke('relaunch_for_update');
    }, []);

    return { isDead, relaunch };
};
