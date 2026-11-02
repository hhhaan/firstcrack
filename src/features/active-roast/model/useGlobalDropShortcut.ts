import { type PressArm, stepDoublePress } from '@shared/lib/double-press';
import { bindingAccelerator, syncGlobalShortcut } from '@shared/lib/global-shortcut';
import { parseShortcutPress } from '@shared/lib/shortcut-key';
import { useEffect, useRef, useState } from 'react';

/**
 * One OS edge of the Drop binding. A single fires on press. A double fires on the second press,
 * after the key was released. The release itself never fires.
 */
export function nextGlobalDrop(
    count: 1 | 2,
    arm: PressArm | null,
    state: 'Pressed' | 'Released',
    chord: string,
    now: number,
): { arm: PressArm | null; fire: boolean } {
    if (count === 1) return { arm: null, fire: state === 'Pressed' };
    return stepDoublePress(arm, { chord, edge: state === 'Pressed' ? 'down' : 'up', now });
}

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
    const stored = enabled && keys.length === 1 ? keys[0] : null;
    const press = stored ? parseShortcutPress(stored) : null;
    const accelerator = stored ? bindingAccelerator(stored) : null;
    const count = press?.count ?? 1;
    const chord = press?.chord ?? '';

    useEffect(() => {
        onFireRef.current = onFire;
    }, [onFire]);

    useEffect(() => {
        let disposed = false;
        let arm: PressArm | null = null;
        setHolding(false);
        void syncGlobalShortcut(accelerator, (state) => {
            const next = nextGlobalDrop(count, arm, state, chord, Date.now());
            arm = next.arm;
            if (next.fire) onFireRef.current();
        }).then((held) => {
            if (!disposed) setHolding(held);
        });
        return () => {
            disposed = true;
            // Release the combo as soon as Drop stops being markable — other apps own it then.
            void syncGlobalShortcut(null, () => undefined);
        };
    }, [accelerator, chord, count]);

    return accelerator !== null && holding;
}
