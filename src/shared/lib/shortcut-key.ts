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

/** One chord, or the same chord written twice (`shift+enter shift+enter`). */
export function parseShortcutPress(shortcut: string): { chord: string; count: 1 | 2 } | null {
    const parts = shortcut.trim().split(/ +/);
    if (parts.length < 1 || parts.length > 2) return null;
    const chords = parts.map((part) => canonicalize(part));
    const chord = chords[0];
    if (!chord || chords.some((item) => item !== chord)) return null;
    return { chord, count: parts.length === 2 ? 2 : 1 };
}

export function shortcutChord(shortcut: string): string {
    return parseShortcutPress(shortcut)?.chord ?? '';
}

export function doubleShortcut(chord: string): string {
    const canonical = canonicalize(chord);
    return canonical ? `${canonical} ${canonical}` : '';
}

export function canonicalShortcut(shortcut: string): string {
    const parsed = parseShortcutPress(shortcut);
    if (!parsed) return '';
    return parsed.count === 2 ? `${parsed.chord} ${parsed.chord}` : parsed.chord;
}

/**
 * `undefined` means the key can be assigned. `taken` is other actions' keys.
 * A single and a double of the same chord conflict, so a single never has to wait.
 */
export function shortcutBindingError(shortcut: string, taken: readonly string[]): ShortcutBindingResult {
    const parsed = parseShortcutPress(shortcut);
    if (!parsed) return 'invalid';
    if (RESERVED_KEYS.has(parsed.chord)) return 'reserved';
    const comparable = conflictKey(parsed.chord);
    if (taken.some((key) => conflictKey(shortcutChord(key)) === comparable)) return 'conflict';
    return undefined;
}

export function sameShortcut(a: string, b: string): boolean {
    const left = parseShortcutPress(a);
    const right = parseShortcutPress(b);
    if (!left || !right || left.count !== right.count) return false;
    return conflictKey(left.chord) === conflictKey(right.chord);
}

export function isReservedShortcut(shortcut: string): boolean {
    const chord = shortcutChord(shortcut);
    return chord !== '' && RESERVED_KEYS.has(chord);
}

export { normalizeKey };
