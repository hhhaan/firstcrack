import { parseShortcut } from '@shared/lib/shortcut-key';
import { useGlobalDropShortcutStore } from '@shared/store/global-drop-shortcut';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { useEffect, useRef } from 'react';
import { nextDropDoubleTap } from '../lib/drop-double-tap';

// Registration and cleanup are ordered even when a phase/key changes before register resolves.
let registrationQueue: Promise<void> = Promise.resolve();
export function nativeDropShortcut(shortcut: string): string | null {
    const parsed = parseShortcut(shortcut);
    if (!parsed?.modifiers.some((m) => ['mod', 'ctrl', 'alt'].includes(m))) return null;
    const modifiers: Record<string, string> = { mod: 'CommandOrControl', ctrl: 'Control', alt: 'Alt', shift: 'Shift' };
    const names: Record<string, string> = {
        left: 'ArrowLeft',
        right: 'ArrowRight',
        up: 'ArrowUp',
        down: 'ArrowDown',
        enter: 'Enter',
        escape: 'Escape',
        space: 'Space',
        '+': 'Plus',
    };
    return [...parsed.modifiers.map((m) => modifiers[m]), names[parsed.key] ?? parsed.key.toUpperCase()].join('+');
}

export function useGlobalDropShortcut(keys: string[], eligible: boolean, onDrop: () => void) {
    const enabled = useGlobalDropShortcutStore((s) => s.enabled);
    const ownsDrop = useRef(false);
    const callback = useRef(onDrop);
    useEffect(() => {
        callback.current = onDrop;
    }, [onDrop]);
    useEffect(() => {
        if (!enabled || !eligible || !keys.length) {
            const { status } = useGlobalDropShortcutStore.getState();
            if (!enabled || !keys.length || (status !== 'failed' && status !== 'unsupported'))
                useGlobalDropShortcutStore.setState({ status: 'idle' });
            return;
        }
        const nativeKeys = keys.map(nativeDropShortcut);
        if (!('__TAURI_INTERNALS__' in window) || nativeKeys.some((key) => key === null)) {
            useGlobalDropShortcutStore.setState({ status: 'unsupported' });
            return;
        }
        const shortcuts = nativeKeys as string[];
        let disposed = false;
        let listening = false;
        const registered: string[] = [];
        let armedAt: number | null = null;
        const held = new Set<string>();
        useGlobalDropShortcutStore.setState({ status: 'registering' });
        ownsDrop.current = true;
        registrationQueue = registrationQueue.then(async () => {
            if (disposed) return;
            try {
                for (const shortcut of shortcuts) {
                    await register(shortcut, (event) => {
                        if (disposed || !listening) return;
                        if (event.state === 'Released') {
                            held.delete(event.shortcut);
                            return;
                        }
                        const repeat = held.has(event.shortcut);
                        held.add(event.shortcut);
                        const next = nextDropDoubleTap(armedAt, Date.now(), repeat);
                        armedAt = next.armedAt;
                        if (next.fire) callback.current();
                    });
                    registered.push(shortcut);
                }
                listening = true;
                if (!disposed) useGlobalDropShortcutStore.setState({ status: 'ready' });
            } catch {
                listening = false;
                if (registered.length) {
                    try {
                        await unregister(registered);
                        registered.length = 0;
                    } catch {
                        /* disposed guard still protects the callback */
                    }
                }
                // OS conflict/unsupported platform: the normal foreground binding remains usable.
                if (!disposed) {
                    ownsDrop.current = false;
                    useGlobalDropShortcutStore.setState({ status: 'failed' });
                }
            }
        });
        return () => {
            disposed = true;
            ownsDrop.current = false;
            registrationQueue = registrationQueue.then(async () => {
                if (registered.length) {
                    try {
                        await unregister(registered);
                    } catch {
                        /* stale handler is disabled by disposed */
                    }
                }
            });
        };
    }, [enabled, eligible, keys]);
    return ownsDrop;
}
