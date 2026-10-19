import { useGlobalDropShortcutStore } from '@shared/store/global-drop-shortcut';
import { register, type ShortcutEvent, unregister } from '@tauri-apps/plugin-global-shortcut';
import { useEffect, useRef } from 'react';
import { nextDropDoubleTap } from '../lib/drop-double-tap';
import { nativeDropShortcuts } from '../lib/global-drop-native';

/**
 * A grab IPC that never settles would block every later registration and leave `ownsDrop` true,
 * which silently kills the foreground Drop shortcut for the rest of the roast.
 */
const SETTLE_TIMEOUT_MS = 3000;

// Registration and cleanup are ordered even when a phase/key changes before register resolves.
let registrationQueue: Promise<void> = Promise.resolve();

const settle = (work: Promise<void>): Promise<void> =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('registration timeout')), SETTLE_TIMEOUT_MS);
        work.then(
            () => {
                clearTimeout(timer);
                resolve();
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });

export function useGlobalDropShortcut(keys: string[], eligible: boolean, onDrop: () => void) {
    const enabled = useGlobalDropShortcutStore((s) => s.enabled);
    const ownsDrop = useRef(false);
    const callback = useRef(onDrop);
    useEffect(() => {
        callback.current = onDrop;
    }, [onDrop]);
    useEffect(() => {
        if (!enabled || !eligible || !keys.length) {
            // A grab failure stays visible in settings; every other reason to stop is transient.
            const { status } = useGlobalDropShortcutStore.getState();
            if (!enabled || !keys.length || (status !== 'failed' && status !== 'unsupported'))
                useGlobalDropShortcutStore.setState({ status: 'idle' });
            return;
        }
        const shortcuts = nativeDropShortcuts(keys);
        if (!shortcuts) {
            useGlobalDropShortcutStore.setState({ status: 'unsupported' });
            return;
        }
        let disposed = false;
        let listening = false;
        let armedAt: number | null = null;
        const held = new Set<string>();
        const onShortcut = (event: ShortcutEvent) => {
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
        };
        useGlobalDropShortcutStore.setState({ status: 'registering' });
        // Own Drop before the grab lands, so one press can never mark it twice.
        ownsDrop.current = true;
        registrationQueue = registrationQueue.then(async () => {
            if (disposed) return;
            const grab = register(shortcuts, onShortcut);
            try {
                await settle(grab);
            } catch {
                // A grab that lands after we gave up would hold the system shortcut for good.
                void grab.then(() => unregister(shortcuts)).catch(() => undefined);
                await unregister(shortcuts).catch(() => undefined);
                if (disposed) return;
                ownsDrop.current = false;
                useGlobalDropShortcutStore.setState({ status: 'failed' });
                return;
            }
            listening = true;
            if (!disposed) {
                useGlobalDropShortcutStore.setState({ status: 'ready' });
                return;
            }
            // Registered after the phase ended: release it now that the order is known.
            await unregister(shortcuts).catch(() => undefined);
        });
        return () => {
            disposed = true;
            listening = false;
            ownsDrop.current = false;
            registrationQueue = registrationQueue.then(() => unregister(shortcuts).catch(() => undefined));
        };
    }, [enabled, eligible, keys]);
    return ownsDrop;
}
