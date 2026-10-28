import { shortcutToAccelerator, syncGlobalShortcut } from '@shared/lib/global-shortcut';
import { useEffect, useRef, useState } from 'react';

/**
 * Drop at OS level, including while the window is unfocused, minimized or hidden (#936).
 *
 * Returns true when the key is actually held globally. The webview hotkey stays armed: a focused
 * window can receive both, and the caller dedupes that pair into one Drop.
 */
export function useGlobalDropShortcut({
    enabled,
    keys,
    onFire,
}: {
    enabled: boolean;
    keys: readonly string[];
    onFire: () => void;
}): boolean {
    const onFireRef = useRef(onFire);
    const [holding, setHolding] = useState(false);
    // One binding maps to one accelerator. Multi-binding actions stay on the webview hotkey.
    const accelerator = enabled && keys.length === 1 ? shortcutToAccelerator(keys[0]) : null;

    useEffect(() => {
        onFireRef.current = onFire;
    }, [onFire]);

    useEffect(() => {
        let disposed = false;
        setHolding(false);
        void syncGlobalShortcut(accelerator, () => onFireRef.current()).then((held) => {
            if (!disposed) setHolding(held);
        });
        return () => {
            disposed = true;
            // Release the combo as soon as Drop stops being markable — other apps own it then.
            void syncGlobalShortcut(null, () => undefined);
        };
    }, [accelerator]);

    return accelerator !== null && holding;
}
