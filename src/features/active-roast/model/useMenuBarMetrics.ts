import { logger } from '@shared/lib/logger';
import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import { useEffect, useEffectEvent, useRef } from 'react';

type MenuBarReading = {
    et: string;
    bt: string;
    ror: string;
    time: string;
};

const isMacDesktop = (): boolean => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return false;
    try {
        return platform() === 'macos';
    } catch {
        return false;
    }
};

/** Updates the native macOS status item while the roast screen is open. */
export const useMenuBarMetrics = (reading: MenuBarReading | null): void => {
    const pending = useRef<Promise<void> | null>(null);
    const reported = useRef(false);
    const signature = reading ? `${reading.et}\n${reading.bt}\n${reading.ror}\n${reading.time}` : '';
    const sync = useEffectEvent((hide: boolean) => {
        const current = hide ? null : reading;
        // Serialize updates and cleanup so a late update cannot resurrect a closed status item.
        pending.current = (pending.current ?? Promise.resolve())
            .then(() => invoke<void>('update_menu_bar_metrics', { reading: current }))
            .catch((error: unknown) => {
                if (reported.current) return;
                reported.current = true;
                logger.capture(error, { feature: 'menu-bar-metrics' });
            });
    });

    useEffect(() => {
        if (isMacDesktop()) sync(signature === '');
    }, [signature]);

    useEffect(
        () => () => {
            if (isMacDesktop()) sync(true);
        },
        [],
    );
};
