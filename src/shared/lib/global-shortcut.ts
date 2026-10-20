import { logger } from '@shared/lib/logger';
import { parseShortcut } from '@shared/lib/shortcut-key';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

/**
 * OS-level shortcuts (#936).
 *
 * A webview `keydown` only exists while the app owns focus — during a roast the operator is
 * usually in another window (scale, notes, spreadsheet). Holding the key at the OS level lets
 * Drop fire anyway. Cost: the combo belongs to First Crack for as long as it is held, so
 * `syncGlobalShortcut(null, …)` must run as soon as the roast stops marking events.
 */

const MODIFIER_ACCELERATORS = {
    mod: 'CommandOrControl',
    ctrl: 'Control',
    alt: 'Alt',
    shift: 'Shift',
} as const;

const NAMED_KEY_ACCELERATORS: Record<string, string> = {
    enter: 'Enter',
    escape: 'Escape',
    space: 'Space',
    tab: 'Tab',
    backspace: 'Backspace',
    delete: 'Delete',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
};

/**
 * Binding (`mod+shift+d`) → accelerator the plugin understands (`CommandOrControl+Shift+D`).
 * `null` means "not registrable": unknown key, or no modifier — an unmodified key registered
 * globally would swallow plain typing in every other app.
 */
export function shortcutToAccelerator(shortcut: string): string | null {
    const parsed = parseShortcut(shortcut);
    if (!parsed) return null;
    if (!parsed.modifiers.length) return null;
    const key = /^(?:[a-z0-9]|f(?:[1-9]|1[0-2]))$/.test(parsed.key)
        ? parsed.key.toUpperCase()
        : NAMED_KEY_ACCELERATORS[parsed.key];
    if (!key) return null;
    const modifiers = parsed.modifiers.map(
        (modifier) => MODIFIER_ACCELERATORS[modifier as keyof typeof MODIFIER_ACCELERATORS],
    );
    return [...modifiers, key].join('+');
}

const isDesktop = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The one accelerator this app holds, and the handler the plugin calls while it is held. */
let heldAccelerator: string | null = null;
let pressHandler: (() => void) | null = null;
let reportedRegistrationFailure = false;
/** Registrations are async and OS state is global — run them one at a time, in order. */
let queue: Promise<unknown> = Promise.resolve();

const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
};

const apply = async (accelerator: string | null): Promise<boolean> => {
    if (heldAccelerator === accelerator) return accelerator !== null;
    if (heldAccelerator) {
        const previous = heldAccelerator;
        heldAccelerator = null;
        await unregister(previous).catch(() => undefined);
    }
    if (!accelerator) return false;
    try {
        // The plugin reports Pressed *and* Released; only the press marks Drop.
        await register(accelerator, (event) => {
            if (event.state === 'Pressed') pressHandler?.();
        });
    } catch (error) {
        // Registration can be refused by the OS (combo taken by another app). The webview
        // hotkey still works while focused, so this is degraded, not broken — report it once.
        if (!reportedRegistrationFailure) {
            reportedRegistrationFailure = true;
            logger.capture(error, { feature: 'active-roast', action: 'globalShortcut.register' });
        }
        return false;
    }
    heldAccelerator = accelerator;
    return true;
};

/**
 * Hold `accelerator` (or nothing when `null`) at OS level. Returns whether it is held now.
 * `onPress` is read at press time, so a re-render does not need a re-registration.
 */
export function syncGlobalShortcut(accelerator: string | null, onPress: () => void): Promise<boolean> {
    pressHandler = onPress;
    if (!isDesktop()) return Promise.resolve(false);
    return serialize(() => apply(accelerator));
}
