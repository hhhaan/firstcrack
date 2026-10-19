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
const SHIFTED_KEYS: Record<string, string> = {
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

const isTauriRuntime = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** `mod+d` → `CommandOrControl+D`. null when the OS cannot own the combination. */
export function nativeDropShortcut(shortcut: string): string | null {
    const parsed = parseShortcut(shortcut);
    // global-hotkey needs a real modifier: Shift alone never registers as a background grab.
    if (!parsed?.modifiers.some((modifier) => ['mod', 'ctrl', 'alt'].includes(modifier))) return null;
    // The native parser accepts physical key codes, not shifted punctuation tokens.
    const shiftedKey = SHIFTED_KEYS[parsed.key];
    const modifiers = shiftedKey ? [...new Set([...parsed.modifiers, 'shift'])] : parsed.modifiers;
    const key = shiftedKey ?? NATIVE_KEYS[parsed.key] ?? parsed.key.toUpperCase();
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
