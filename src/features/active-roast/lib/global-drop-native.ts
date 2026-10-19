import { parseShortcut } from '@shared/lib/shortcut-key';

/**
 * Background Drop is a system-wide key grab, so the OS owns it rather than the webview.
 * global-hotkey parses a `Code` token list, not the binding syntax used inside the app.
 */
const NATIVE_MODIFIERS: Record<string, string> = {
    mod: 'CommandOrControl',
    ctrl: 'Control',
    alt: 'Alt',
    shift: 'Shift',
};

const NATIVE_KEYS: Record<string, string> = {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    up: 'ArrowUp',
    down: 'ArrowDown',
    enter: 'Enter',
    escape: 'Escape',
    space: 'Space',
};

const isTauriRuntime = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** `mod+d` → `CommandOrControl+D`. null when the OS cannot own the combination. */
export function nativeDropShortcut(shortcut: string): string | null {
    const parsed = parseShortcut(shortcut);
    // global-hotkey needs a real modifier: Shift alone never registers as a background grab.
    if (!parsed?.modifiers.some((modifier) => ['mod', 'ctrl', 'alt'].includes(modifier))) return null;
    // It has no `+` key code, and the recorder only accepts `+` as Shift+Equal on Latin layouts.
    const plus = parsed.key === '+';
    const modifiers = plus ? [...new Set([...parsed.modifiers, 'shift'])] : parsed.modifiers;
    const key = plus ? 'Equal' : (NATIVE_KEYS[parsed.key] ?? parsed.key.toUpperCase());
    return [...modifiers.map((modifier) => NATIVE_MODIFIERS[modifier]), key].join('+');
}

/** Native registrations for the whole binding list, or null if any of it cannot be grabbed. */
export function nativeDropShortcuts(keys: string[]): string[] | null {
    if (!isTauriRuntime() || !keys.length) return null;
    const shortcuts = keys.map(nativeDropShortcut);
    return shortcuts.some((shortcut) => shortcut === null) ? null : (shortcuts as string[]);
}

/** Settings shows this before a roast starts, so an unsupported binding is not a silent surprise. */
export function globalDropSupport(keys: string[]): 'idle' | 'unsupported' {
    return nativeDropShortcuts(keys) ? 'idle' : 'unsupported';
}
