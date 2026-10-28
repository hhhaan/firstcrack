import { shortcutToAccelerator, syncGlobalShortcuts } from '@shared/lib/global-shortcut';
import { useCallback, useEffect, useRef } from 'react';

interface RoastShortcut {
    id: string;
    keys: readonly string[];
    enabled: boolean;
    global?: boolean;
    enableOnFormTags?: boolean;
    onFire: () => void;
}

/** Keep event keys registered while minimized/hidden, and dedupe OS + webview delivery. */
export function useGlobalRoastShortcuts(shortcuts: readonly RoastShortcut[]) {
    const shortcutsRef = useRef(shortcuts);
    const lastPressAt = useRef(new Map<string, number>());
    const fireShortcut = useCallback((id: string) => {
        const shortcut = shortcutsRef.current.find((item) => item.id === id);
        if (!shortcut?.enabled) return;
        const now = Date.now();
        if (now - (lastPressAt.current.get(id) ?? -Infinity) < 100) return;
        lastPressAt.current.set(id, now);
        shortcut.onFire();
    }, []);

    useEffect(() => {
        shortcutsRef.current = shortcuts;
        const bindings = new Map<string, () => void>();
        for (const shortcut of shortcuts) {
            if (!shortcut.enabled || shortcut.global === false) continue;
            for (const key of shortcut.keys) {
                const accelerator = shortcutToAccelerator(key);
                if (!accelerator) continue;
                bindings.set(accelerator, () => {
                    const current = shortcutsRef.current.find((item) => item.id === shortcut.id);
                    if (
                        !current?.enableOnFormTags &&
                        document.hasFocus() &&
                        document.activeElement?.closest(
                            'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
                        )
                    )
                        return;
                    fireShortcut(shortcut.id);
                });
            }
        }
        void syncGlobalShortcuts(bindings);
    });

    useEffect(() => () => void syncGlobalShortcuts(new Map()), []);

    return fireShortcut;
}
