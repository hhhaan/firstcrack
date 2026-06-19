import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

export const useSidecarDeadListener = (): { isDead: boolean } => {
    const [isDead, setIsDead] = useState(false);

    useEffect(() => {
        let unlisten: (() => void) | undefined;

        listen<null>('sidecar-dead', () => {
            setIsDead(true);
        }).then((fn) => {
            unlisten = fn;
        });

        return () => unlisten?.();
    }, []);

    return { isDead };
};
