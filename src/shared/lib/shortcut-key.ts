import { isAppleOs } from '@shared/lib/mod-key';

export type ShortcutBindingResult = 'conflict' | 'reserved' | 'invalid' | undefined;

const RESERVED_KEYS = new Set(['escape', 'tab', 'backspace', 'f5', 'mod+r', 'mod+shift+r']);
const KEY_ALIASES: Record<string, string> = {
    arrowleft: 'left',
    arrowright: 'right',
    arrowup: 'up',
    arrowdown: 'down',
    return: 'enter',
    ' ': 'space',
};
const MODIFIERS = ['mod', 'ctrl', 'alt', 'shift'] as const;
const NAMED_KEYS = new Set([
    'enter',
    'escape',
    'tab',
    'backspace',
    'delete',
    'home',
    'end',
    'pageup',
    'pagedown',
    'left',
    'right',
    'up',
    'down',
]);

const normalizeKey = (key: string): string => KEY_ALIASES[key.toLowerCase()] ?? key.toLowerCase();

const isPunctuationKey = (key: string): boolean => {
    const code = key.charCodeAt(0);
    return key.length === 1 && code >= 33 && code <= 126 && !/^[a-z0-9]$/.test(key);
};

export function parseShortcut(shortcut: string): { modifiers: string[]; key: string } | null {
    const value = shortcut.trim().toLowerCase();
    let parts: string[];
    let key: string | undefined;
    if (value === '+') {
        parts = [];
        key = '+';
    } else if (value.endsWith('++')) {
        parts = value.slice(0, -2).split('+');
        key = '+';
    } else {
        parts = value.split('+');
        key = parts.pop();
    }
    if (!key || parts.some((part) => !part)) return null;
    const modifiers = MODIFIERS.filter((modifier) => parts.includes(modifier));
    if (parts.length !== modifiers.length) return null;
    key = normalizeKey(key);
    if (
        MODIFIERS.includes(key as (typeof MODIFIERS)[number]) ||
        !(/^[a-z0-9]$/.test(key) || /^f(?:[1-9]|1[0-2])$/.test(key) || NAMED_KEYS.has(key) || isPunctuationKey(key))
    )
        return null;
    return { modifiers, key };
}

export const canonicalize = (shortcut: string): string => {
    const parsed = parseShortcut(shortcut);
    if (!parsed) return '';
    const modifiers = ['+', '_'].includes(parsed.key)
        ? parsed.modifiers.filter((modifier) => modifier !== 'shift')
        : parsed.modifiers;
    return [...modifiers, parsed.key].join('+');
};

export const conflictKey = (shortcut: string): string =>
    isAppleOs() ? shortcut : shortcut.replace(/(^|\+)ctrl(?=\+|$)/, '$1mod');

export function canonicalShortcut(shortcut: string): string {
    return canonicalize(shortcut);
}

/** `undefined` means the key can be assigned. `taken` is other actions' keys. */
export function shortcutBindingError(shortcut: string, taken: readonly string[]): ShortcutBindingResult {
    const canonical = canonicalize(shortcut);
    if (!canonical) return 'invalid';
    if (RESERVED_KEYS.has(canonical)) return 'reserved';
    const comparable = conflictKey(canonical);
    if (taken.some((key) => conflictKey(canonicalize(key)) === comparable)) return 'conflict';
    return undefined;
}

export function sameShortcut(a: string, b: string): boolean {
    const left = canonicalize(a);
    const right = canonicalize(b);
    return left !== '' && conflictKey(left) === conflictKey(right);
}

export function isReservedShortcut(shortcut: string): boolean {
    const canonical = canonicalize(shortcut);
    return canonical !== '' && RESERVED_KEYS.has(canonical);
}

export { normalizeKey };
