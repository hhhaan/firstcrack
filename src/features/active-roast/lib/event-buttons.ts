import { canonicalShortcut, shortcutBindingError } from '@shared/lib/shortcut-key';

export const CUSTOM_EVENT_LIMIT = 8;
export const CUSTOM_EVENT_NAME_MAX = 16;

/** Digit keys after the built-in marks. ⌘3 stays on FC End. */
export const CUSTOM_EVENT_SHORTCUTS = ['mod+4', 'mod+5', 'mod+6', 'mod+7', 'mod+8', 'mod+9', 'mod+0'] as const;

export type CustomRoastEvent = {
    id: string;
    name: string;
    enabled: boolean;
    /** Canonical shortcut. Missing means the next free digit key. */
    shortcut?: string;
};

export type RoastEventButtons = {
    yellow: boolean;
    fcStart: boolean;
    fcEnd: boolean;
    custom: CustomRoastEvent[];
};

export const DEFAULT_EVENT_BUTTONS: RoastEventButtons = {
    yellow: true,
    fcStart: true,
    fcEnd: true,
    custom: [],
};

/** Stored ids and their on-screen names. A custom button must not reuse either. */
const RESERVED_EVENT_NAMES = [
    'Charge',
    'Yellow',
    'TP',
    'FC Start',
    'FC Rolling',
    'FC End',
    'Drop',
    'End',
    'Note',
    'Heater',
    'Now',
    'Control',
    'Mark Drop',
    'First Crack',
    'End Roast',
    'Roast Ready',
    '투입',
    '컬러 체인지',
    '1차크랙',
    '퍼스크크랙롤링',
    '2차크랙',
    '배출',
    '로스팅 종료',
    '로스팅 준비',
    '터닝 포인트',
];

const reservedKey = (name: string) => name.trim().toLocaleLowerCase();
const RESERVED_KEYS = new Set(RESERVED_EVENT_NAMES.map(reservedKey));

/** Log types that already have a meaning. Anything else is a user-named mark. */
const KNOWN_LOG_EVENTS = new Set([
    'Charge',
    'Yellow',
    'TP',
    'FC Start',
    'FC Rolling',
    'FC End',
    'Drop',
    'End',
    'Note',
    'Heater',
    'Now',
    'Control',
]);

export const isReservedRoastEventName = (name: string): boolean => RESERVED_KEYS.has(reservedKey(name));

export const isCustomRoastEvent = (event: string): boolean => {
    const name = event.trim();
    return name.length > 0 && !KNOWN_LOG_EVENTS.has(name);
};

export type EventNameError = 'invalid' | 'limit';

export const eventNameError = (raw: string, existing: readonly string[], atLimit: boolean): EventNameError | null => {
    const name = raw.trim();
    if (!name || name.length > CUSTOM_EVENT_NAME_MAX || isReservedRoastEventName(name)) return 'invalid';
    if (existing.some((item) => item.trim() === name)) return 'invalid';
    if (atLimit) return 'limit';
    return null;
};

export const normalizeEventButtons = (raw: unknown): RoastEventButtons => {
    const src = raw && typeof raw === 'object' ? (raw as Partial<RoastEventButtons>) : {};
    const custom: CustomRoastEvent[] = [];
    const names = new Set<string>();
    const ids = new Set<string>();
    if (Array.isArray(src.custom)) {
        for (const item of src.custom) {
            if (custom.length >= CUSTOM_EVENT_LIMIT) break;
            if (!item || typeof item !== 'object') continue;
            const row = item as Partial<CustomRoastEvent>;
            const name = typeof row.name === 'string' ? row.name.trim() : '';
            const id = typeof row.id === 'string' ? row.id.trim() : '';
            if (!id || !name || name.length > CUSTOM_EVENT_NAME_MAX) continue;
            if (isReservedRoastEventName(name) || names.has(name) || ids.has(id)) continue;
            names.add(name);
            ids.add(id);
            const usedShortcuts = custom.flatMap((item) => (item.shortcut ? [item.shortcut] : []));
            const shortcut =
                typeof row.shortcut === 'string' && !shortcutBindingError(row.shortcut, usedShortcuts)
                    ? canonicalShortcut(row.shortcut)
                    : undefined;
            custom.push({ id, name, enabled: row.enabled !== false, ...(shortcut ? { shortcut } : {}) });
        }
    }
    return {
        yellow: src.yellow !== false,
        fcStart: src.fcStart !== false,
        fcEnd: src.fcEnd !== false,
        custom,
    };
};

/**
 * Shortcut that will actually fire for each custom row.
 * An explicit key that is already taken stays empty so it does not silently move.
 * A row with no key takes the next free digit, including rows whose button is hidden.
 */
export function effectiveCustomShortcuts(
    custom: readonly Pick<CustomRoastEvent, 'shortcut'>[],
    taken: readonly string[],
): (string | undefined)[] {
    const used = [...taken];
    const assigned = custom.map((item) => {
        const raw = item.shortcut?.trim() ?? '';
        if (!raw) return null;
        if (shortcutBindingError(raw, used)) return false;
        const key = canonicalShortcut(raw);
        used.push(key);
        return key;
    });
    return assigned.map((slot) => {
        if (typeof slot === 'string') return slot;
        if (slot === false) return undefined;
        const auto = CUSTOM_EVENT_SHORTCUTS.find((candidate) => !shortcutBindingError(candidate, used));
        if (!auto) return undefined;
        used.push(auto);
        return auto;
    });
}

export function nextCustomEventShortcut(taken: readonly string[]): string | undefined {
    return CUSTOM_EVENT_SHORTCUTS.find((key) => !shortcutBindingError(key, taken));
}
