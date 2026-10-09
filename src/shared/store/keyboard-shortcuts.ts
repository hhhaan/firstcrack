import { isAppleOs } from '@shared/lib/mod-key';
import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import { create } from 'zustand';

export const SHORTCUTS = [
    { id: 'openSettings', defaultKeys: ['mod+,'], group: 'app', editable: true },
    { id: 'openShortcuts', defaultKeys: ['mod+/'], group: 'app', editable: true },
    { id: 'toggleSidebar', defaultKeys: ['mod+b'], group: 'app', editable: true },
    { id: 'toggleFullscreen', defaultKeys: ['f'], group: 'roast', editable: true },
    { id: 'exitFullscreen', defaultKeys: ['escape'], group: 'roast', editable: false },
    { id: 'charge', defaultKeys: ['mod+enter'], group: 'roast', editable: true },
    { id: 'yellow', defaultKeys: ['mod+1'], group: 'roast', editable: true },
    { id: 'fcStart', defaultKeys: ['mod+2'], group: 'roast', editable: true },
    { id: 'fcEnd', defaultKeys: ['mod+3'], group: 'roast', editable: true },
    { id: 'drop', defaultKeys: ['mod+d'], group: 'roast', editable: true },
    { id: 'toggleControl', defaultKeys: ['t'], group: 'roast', editable: true },
    { id: 'zoomIn', defaultKeys: ['+', '='], group: 'chart', editable: true },
    { id: 'zoomOut', defaultKeys: ['-', '_'], group: 'chart', editable: true },
    { id: 'resetZoom', defaultKeys: ['0'], group: 'chart', editable: true },
    { id: 'panLeft', defaultKeys: ['left'], group: 'chart', editable: true },
    { id: 'panRight', defaultKeys: ['right'], group: 'chart', editable: true },
] as const satisfies readonly {
    id: string;
    defaultKeys: readonly string[];
    group: 'app' | 'roast' | 'chart';
    editable?: boolean;
}[];

export type ShortcutId = (typeof SHORTCUTS)[number]['id'];
export type ShortcutBindingResult = 'conflict' | 'reserved' | 'invalid' | undefined;
export type ShortcutBindings = Record<ShortcutId, string[]>;

const STORE_KEY = 'keyboard.bindings';
const DISABLED_STORE_KEY = 'keyboard.disabled';
const EMPTY_KEYS: string[] = [];
const RESERVED_KEYS = new Set(['escape', 'tab', 'backspace', 'f5', 'mod+r', 'mod+shift+r']);
const DEFAULT_BINDINGS = Object.fromEntries(
    SHORTCUTS.map(({ id, defaultKeys }) => [id, [...defaultKeys]]),
) as ShortcutBindings;

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

function parseShortcut(shortcut: string): { modifiers: string[]; key: string } | null {
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

const canonicalize = (shortcut: string): string => {
    const parsed = parseShortcut(shortcut);
    if (!parsed) return '';
    const modifiers = ['+', '_'].includes(parsed.key)
        ? parsed.modifiers.filter((modifier) => modifier !== 'shift')
        : parsed.modifiers;
    return [...modifiers, parsed.key].join('+');
};

const conflictKey = (shortcut: string): string =>
    isAppleOs() ? shortcut : shortcut.replace(/(^|\+)ctrl(?=\+|$)/, '$1mod');

export function parseShortcutBindings(value: unknown): Partial<ShortcutBindings> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const candidate = structuredClone(DEFAULT_BINDINGS);
    const customized = new Set<ShortcutId>();
    for (const shortcut of SHORTCUTS) {
        const { id } = shortcut;
        const { editable } = shortcut;
        if (!editable) continue;
        const keys = (value as Record<string, unknown>)[id];
        if (!Array.isArray(keys)) continue;
        const normalized = keys.map((key) => (typeof key === 'string' ? canonicalize(key) : ''));
        if (!normalized.length || normalized.some((key) => !key || RESERVED_KEYS.has(key))) continue;
        candidate[id] = [...new Set(normalized)];
        customized.add(id);
    }

    while (true) {
        const owners = new Map<string, ShortcutId[]>();
        for (const [id, keys] of Object.entries(candidate) as [ShortcutId, string[]][]) {
            for (const key of keys) {
                const comparable = conflictKey(key);
                owners.set(comparable, [...(owners.get(comparable) ?? []), id]);
            }
        }
        const conflicts = new Set([...owners.values()].filter((ids) => ids.length > 1).flat());
        if (!conflicts.size) break;
        let resetAny = false;
        for (const id of conflicts) {
            if (!customized.delete(id)) continue;
            candidate[id] = [...DEFAULT_BINDINGS[id]];
            resetAny = true;
        }
        if (!resetAny) break;
    }

    return Object.fromEntries([...customized].map((id) => [id, candidate[id]])) as Partial<ShortcutBindings>;
}

interface ShortcutState {
    bindings: ShortcutBindings;
    disabled: ShortcutId[];
    recording: boolean;
    dialogOpen: boolean;
    hydrated: boolean;
    setRecording: (recording: boolean) => void;
    setDialogOpen: (dialogOpen: boolean) => void;
    setBinding: (id: ShortcutId, key: string) => ShortcutBindingResult;
    setEnabled: (id: ShortcutId, enabled: boolean) => void;
    resetBindings: () => void;
}

let editVersion = 0;

const persistSetting = (key: string, value: ShortcutBindings | ShortcutId[]) => {
    editVersion += 1;
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Desktop settings remain authoritative when browser storage is unavailable.
    }
    void settingsSet(key, value).catch(() => undefined);
};

export const useShortcutStore = create<ShortcutState>((set, get) => ({
    bindings: structuredClone(DEFAULT_BINDINGS),
    disabled: [],
    recording: false,
    dialogOpen: false,
    hydrated: false,
    setRecording: (recording) => set({ recording }),
    setDialogOpen: (dialogOpen) => set({ dialogOpen, ...(dialogOpen ? {} : { recording: false }) }),
    setBinding: (id, key) => {
        const definition = SHORTCUTS.find((shortcut) => shortcut.id === id);
        const canonical = canonicalize(key);
        if (!definition?.editable || !canonical) return 'invalid';
        if (RESERVED_KEYS.has(canonical)) return 'reserved';
        if (
            Object.entries(get().bindings).some(
                ([otherId, keys]) =>
                    otherId !== id &&
                    keys.some((existing) => conflictKey(canonicalize(existing)) === conflictKey(canonical)),
            )
        )
            return 'conflict';
        const bindings = { ...get().bindings, [id]: [canonical] };
        set({ bindings });
        persistSetting(STORE_KEY, bindings);
    },
    setEnabled: (id, enabled) => {
        const disabled = get().disabled.filter((shortcutId) => shortcutId !== id);
        if (!enabled) disabled.push(id);
        set({ disabled });
        persistSetting(DISABLED_STORE_KEY, disabled);
    },
    resetBindings: () => {
        const bindings = structuredClone(DEFAULT_BINDINGS);
        set({ bindings, disabled: [] });
        persistSetting(STORE_KEY, bindings);
        persistSetting(DISABLED_STORE_KEY, []);
    },
}));

export async function hydrateShortcutBindings(): Promise<void> {
    const startedAtVersion = editVersion;
    const [stored, disabled] = await Promise.all(
        [STORE_KEY, DISABLED_STORE_KEY].map(async (key) => {
            try {
                const value = await settingsGet<unknown>(key);
                return value ?? JSON.parse(localStorage.getItem(key) ?? 'null');
            } catch {
                try {
                    return JSON.parse(localStorage.getItem(key) ?? 'null');
                } catch {
                    return undefined;
                }
            }
        }),
    );
    if (startedAtVersion === editVersion) {
        useShortcutStore.setState((state) => ({
            bindings: { ...state.bindings, ...parseShortcutBindings(stored) },
            disabled: SHORTCUTS.filter(({ id }) => Array.isArray(disabled) && disabled.includes(id)).map(
                ({ id }) => id,
            ),
            hydrated: true,
        }));
    } else {
        useShortcutStore.setState({ hydrated: true });
    }
}

void hydrateShortcutBindings();

export const useShortcutKeys = (id: ShortcutId): string[] =>
    useShortcutStore((state) => (state.disabled.includes(id) ? EMPTY_KEYS : state.bindings[id]));

export function eventToShortcut(
    event: {
        key: string;
        metaKey?: boolean;
        ctrlKey?: boolean;
        altKey?: boolean;
        shiftKey?: boolean;
    },
    apple = isAppleOs(),
): string {
    const key = normalizeKey(event.key);
    if (['meta', 'control', 'alt', 'shift'].includes(key)) return '';
    if (!apple && event.metaKey) return '';
    const modifiers = [
        (apple && event.metaKey) || (!apple && event.ctrlKey) ? 'mod' : '',
        apple && event.ctrlKey ? 'ctrl' : '',
        event.altKey ? 'alt' : '',
        event.shiftKey && !['+', '_'].includes(key) ? 'shift' : '',
    ].filter(Boolean);
    return canonicalize(
        key === '+' ? `${modifiers.join('+')}${modifiers.length ? '++' : '+'}` : [...modifiers, key].join('+'),
    );
}

export const SHORTCUT_HOTKEY_OPTIONS = {
    delimiter: '\n',
    splitKey: '\t',
    sequenceSplitKey: '\0',
    useKey: true,
} as const;

export function shortcutHotkeys(keys: readonly string[]): string {
    return keys
        .flatMap((shortcut) => {
            const parsed = parseShortcut(shortcut);
            if (!parsed) return [];
            const variants = [[...parsed.modifiers, parsed.key]];
            if (['+', '_'].includes(parsed.key) && !parsed.modifiers.includes('shift')) {
                variants.push([...parsed.modifiers, 'shift', parsed.key]);
            }
            return variants.map((parts) => parts.join('\t'));
        })
        .filter(Boolean)
        .join('\n');
}

export function formatShortcut(keys: string | readonly string[], apple = isAppleOs()): string {
    const formatOne = (shortcut: string) => {
        const parsed = parseShortcut(shortcut);
        if (!parsed) return shortcut;
        return [...parsed.modifiers, parsed.key]
            .map((key) => {
                if (key === 'mod') return apple ? '⌘' : 'Ctrl';
                if (key === 'alt') return apple ? '⌥' : 'Alt';
                if (key === 'shift') return apple ? '⇧' : 'Shift';
                if (key === 'enter') return '↵';
                if (key === 'escape') return 'Esc';
                if (key === 'left') return '←';
                if (key === 'right') return '→';
                return key.length === 1 ? key.toUpperCase() : key;
            })
            .join(apple ? '' : '+');
    };
    return (typeof keys === 'string' ? [keys] : keys).map(formatOne).join(' / ');
}
