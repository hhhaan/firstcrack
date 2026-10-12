import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

export const useSidecarDeadListener = (): { isDead: boolean } => {
    const [isDead, setIsDead] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let unlisten: (() => void) | undefined;

        void listen<null>('sidecar-dead', () => {
            setIsDead(true);
        }).then((fn) => {
            // listen이 cleanup보다 늦게 resolve되면 구독이 남는다
            if (cancelled) fn();
            else unlisten = fn;
        });

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);

    return { isDead };
};
