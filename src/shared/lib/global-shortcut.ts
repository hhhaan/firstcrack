import { logger } from '@shared/lib/logger';
import { parseShortcut } from '@shared/lib/shortcut-key';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

/**
 * OS registrations survive blur, minimize and hide. Release each combo as soon as its
 * roast action is unavailable so other applications can use it again.
 */

const MODIFIER_ACCELERATORS = {
    mod: 'CommandOrControl',
    ctrl: 'Control',
    alt: 'Alt',
    shift: 'Shift',
} as const;

const NAMED_KEY_ACCELERATORS: Record<string, string | undefined> = {
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

const SHIFTED_KEY_ACCELERATORS: Record<string, string | undefined> = {
    '!': 'Digit1',
    '@': 'Digit2',
    '#': 'Digit3',
    $: 'Digit4',
    '%': 'Digit5',
    '^': 'Digit6',
    '&': 'Digit7',
    '*': 'Digit8',
    '(': 'Digit9',
    ')': 'Digit0',
    _: 'Minus',
    '+': 'Equal',
    '{': 'BracketLeft',
    '}': 'BracketRight',
    '|': 'Backslash',
    ':': 'Semicolon',
    '"': 'Quote',
    '<': 'Comma',
    '>': 'Period',
    '?': 'Slash',
    '~': 'Backquote',
};

/**
 * Binding (`mod+shift+d`) → accelerator the plugin understands (`CommandOrControl+Shift+D`).
 * `null` means "not registrable": unknown key, or no modifier — an unmodified key registered
 * globally would swallow plain typing in every other app.
 */
export function shortcutToAccelerator(shortcut: string): string | null {
    const parsed = parseShortcut(shortcut);
    if (!parsed) return null;
    if (!parsed.modifiers.some((modifier) => modifier !== 'shift')) return null;
    const shiftedKey = SHIFTED_KEY_ACCELERATORS[parsed.key];
    const key = shiftedKey ?? NAMED_KEY_ACCELERATORS[parsed.key] ?? parsed.key.toUpperCase();
    const modifierKeys = shiftedKey ? [...new Set([...parsed.modifiers, 'shift'])] : parsed.modifiers;
    const modifiers = modifierKeys.map(
        (modifier) => MODIFIER_ACCELERATORS[modifier as keyof typeof MODIFIER_ACCELERATORS],
    );
    return [...modifiers, key].join('+');
}

const isDesktop = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const heldAccelerators = new Set<string>();
let pressHandlers = new Map<string, () => void>();
let reportedRegistrationFailure = false;
let reportedUnregistrationFailure = false;
/** Registrations are async and OS state is global — run them one at a time, in order. */
let queue: Promise<unknown> = Promise.resolve();

const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
};

const apply = async (accelerators: ReadonlySet<string>): Promise<void> => {
    for (const previous of heldAccelerators) {
        if (accelerators.has(previous)) continue;
        try {
            await unregister(previous);
            heldAccelerators.delete(previous);
        } catch (error) {
            if (!reportedUnregistrationFailure) {
                reportedUnregistrationFailure = true;
                logger.capture(error, { feature: 'active-roast', action: 'globalShortcut.unregister' });
            }
        }
    }
    for (const accelerator of accelerators) {
        if (heldAccelerators.has(accelerator)) continue;
        try {
            await register(accelerator, (event) => {
                if (event.state === 'Pressed') pressHandlers.get(accelerator)?.();
            });
            heldAccelerators.add(accelerator);
        } catch (error) {
            // A refused combo keeps its local hotkey; the other global keys still register.
            if (!reportedRegistrationFailure) {
                reportedRegistrationFailure = true;
                logger.capture(error, { feature: 'active-roast', action: 'globalShortcut.register' });
            }
        }
    }
};

/** Replace the desired bindings. Callbacks change immediately; OS changes run in order. */
export function syncGlobalShortcuts(bindings: ReadonlyMap<string, () => void>): Promise<void> {
    pressHandlers = new Map(bindings);
    if (!isDesktop()) return Promise.resolve();
    return serialize(() => apply(new Set(pressHandlers.keys())));
}
