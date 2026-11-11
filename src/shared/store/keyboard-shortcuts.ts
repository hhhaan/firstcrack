import { isAppleOs } from '@shared/lib/mod-key';
import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import {
    canonicalize,
    canonicalShortcut,
    conflictKey,
    isReservedShortcut,
    parseShortcut,
    parseShortcutPress,
    resolveEventKey,
    type ShortcutBindingResult,
    shortcutBindingError,
} from '@shared/lib/shortcut-key';
import { create } from 'zustand';

export { canonicalShortcut, sameShortcut, shortcutBindingError, shortcutCaptureError } from '@shared/lib/shortcut-key';
export type { ShortcutBindingResult };

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
    { id: 'drop', defaultKeys: ['mod+shift+d'], group: 'roast', editable: true },
    { id: 'closeRoastSummary', defaultKeys: ['mod+shift+6'], group: 'roast', editable: true },
    { id: 'returnToChargeWait', defaultKeys: ['mod+shift+7'], group: 'roast', editable: true },
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
export type ShortcutBindings = Record<ShortcutId, string[]>;

const STORE_KEY = 'keyboard.bindings';
const DISABLED_STORE_KEY = 'keyboard.disabled';
const VERSION_STORE_KEY = 'keyboard.bindingsVersion';
/** 2: Drop moved to `mod+shift+d` and became an OS-level shortcut (#936).
 *  3: Summary / charge-wait shortcuts moved off the custom-event digit pool (#1137). */
const BINDINGS_VERSION = 3;
const EMPTY_KEYS: string[] = [];
const DEFAULT_BINDINGS = Object.fromEntries(
    SHORTCUTS.map(({ id, defaultKeys }) => [id, [...defaultKeys]]),
) as ShortcutBindings;

const pressToken = (key: string): string | null => {
    const press = parseShortcutPress(key);
    if (!press) return null;
    return `${conflictKey(press.chord)}\0${press.count}`;
};

/** Defaults added after users could already bind the same chord. The older binding keeps it. */
const YIELD_DEFAULT_TO_CUSTOM = new Set<ShortcutId>(['closeRoastSummary', 'returnToChargeWait']);

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
        const normalized = keys.map((key) => (typeof key === 'string' ? canonicalShortcut(key) : ''));
        if (!normalized.length || normalized.some((key) => !key || isReservedShortcut(key))) continue;
        candidate[id] = [...new Set(normalized)];
        customized.add(id);
    }

    while (true) {
        const owners = new Map<string, ShortcutId[]>();
        for (const [id, keys] of Object.entries(candidate) as [ShortcutId, string[]][]) {
            for (const key of keys) {
                const token = pressToken(key);
                if (!token) continue;
                owners.set(token, [...(owners.get(token) ?? []), id]);
            }
        }
        const groups = [...owners.entries()].filter(([, ids]) => ids.length > 1);
        if (!groups.length) break;
        let yielded = false;
        for (const [token, ids] of groups) {
            const customOwners = ids.filter((id) => customized.has(id));
            const yielding = ids.filter((id) => !customized.has(id) && YIELD_DEFAULT_TO_CUSTOM.has(id));
            if (!customOwners.length || !yielding.length) continue;
            for (const id of yielding) {
                const kept = candidate[id].filter((key) => pressToken(key) !== token);
                if (kept.length === candidate[id].length) continue;
                candidate[id] = kept;
                customized.add(id);
                yielded = true;
            }
        }
        if (yielded) continue;
        let resetAny = false;
        for (const id of new Set(groups.flatMap(([, ids]) => ids))) {
            if (!customized.delete(id)) continue;
            candidate[id] = [...DEFAULT_BINDINGS[id]];
            resetAny = true;
        }
        if (!resetAny) break;
    }

    return Object.fromEntries([...customized].map((id) => [id, candidate[id]])) as Partial<ShortcutBindings>;
}

/**
 * Defaults the app shipped earlier. Every edit persists the whole map, so these stay in storage as
 * if the user had chosen them — dropping them lets the current default apply. A stale `mod+d`
 * matters beyond ergonomics: the Drop binding is what gets held globally while roasting.
 */
const SUPERSEDED_DEFAULTS: Partial<Record<ShortcutId, { since: number; keys: readonly string[] }>> = {
    drop: { since: 2, keys: ['mod+d'] },
    closeRoastSummary: { since: 3, keys: ['mod+6'] },
    returnToChargeWait: { since: 3, keys: ['mod+7'] },
};

/** Stored bindings that still equal a superseded default fall back to the current one.
 * A stored version at or above `since` already made that choice, including putting the old chord back. */
export function upgradeShortcutBindings(
    bindings: ShortcutBindings,
    storedVersion = 0,
): {
    bindings: ShortcutBindings;
    changed: boolean;
} {
    let changed = false;
    const next = { ...bindings };
    for (const [id, superseded] of Object.entries(SUPERSEDED_DEFAULTS) as [
        ShortcutId,
        { since: number; keys: readonly string[] },
    ][]) {
        if (storedVersion >= superseded.since) continue;
        if (superseded.keys.join('|') !== next[id].join('|')) continue;
        const taken = new Set(
            Object.entries(next).flatMap(([otherId, keys]) =>
                otherId === id
                    ? []
                    : keys.flatMap((key) => {
                          const token = pressToken(key);
                          return token == null ? [] : [token];
                      }),
            ),
        );
        const replacement = DEFAULT_BINDINGS[id].filter((key) => {
            const token = pressToken(key);
            return token == null || !taken.has(token);
        });
        if (replacement.join('|') === next[id].join('|')) continue;
        next[id] = replacement;
        changed = true;
    }
    return { bindings: next, changed };
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

const persistSetting = (key: string, value: ShortcutBindings | ShortcutId[] | number) => {
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
        if (!definition?.editable) return 'invalid';
        const taken = Object.entries(get().bindings).flatMap(([otherId, keys]) => (otherId === id ? [] : keys));
        const failure = shortcutBindingError(key, taken);
        if (failure) return failure;
        const bindings = { ...get().bindings, [id]: [canonicalShortcut(key)] };
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
    const readStored = async (key: string): Promise<unknown> => {
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
    };
    const [stored, disabled, storedVersion] = await Promise.all([
        readStored(STORE_KEY),
        readStored(DISABLED_STORE_KEY),
        readStored(VERSION_STORE_KEY),
    ]);
    if (startedAtVersion !== editVersion) {
        useShortcutStore.setState({ hydrated: true });
        return;
    }

    const merged = { ...useShortcutStore.getState().bindings, ...parseShortcutBindings(stored) };
    // Bindings persisted by an older app version still carry that version's defaults.
    const storedVersionNumber = typeof storedVersion === 'number' && Number.isFinite(storedVersion) ? storedVersion : 0;
    const migrated = storedVersionNumber >= BINDINGS_VERSION;
    const { bindings, changed } = migrated
        ? { bindings: merged, changed: false }
        : upgradeShortcutBindings(merged, storedVersionNumber);
    if (changed) persistSetting(STORE_KEY, bindings);
    if (!migrated) persistSetting(VERSION_STORE_KEY, BINDINGS_VERSION);

    useShortcutStore.setState({
        bindings,
        disabled: SHORTCUTS.filter(({ id }) => Array.isArray(disabled) && disabled.includes(id)).map(({ id }) => id),
        hydrated: true,
    });
}

void hydrateShortcutBindings();

export const useShortcutKeys = (id: ShortcutId): string[] =>
    useShortcutStore((state) => (state.disabled.includes(id) ? EMPTY_KEYS : state.bindings[id]));

export function eventToShortcut(
    event: {
        key: string;
        code?: string;
        metaKey?: boolean;
        ctrlKey?: boolean;
        altKey?: boolean;
        shiftKey?: boolean;
    },
    apple = isAppleOs(),
): string {
    const key = resolveEventKey(event);
    if (!key) return '';
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
            // A double (`shift+enter shift+enter`) is not a library sequence. The double listener owns it.
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
    const formatChord = (shortcut: string) => {
        const parsed = parseShortcut(shortcut);
        if (!parsed) return shortcut;
        return [...parsed.modifiers, parsed.key]
            .map((key) => {
                if (key === 'mod') return apple ? '⌘' : 'Ctrl';
                if (key === 'alt') return apple ? '⌥' : 'Alt';
                if (key === 'shift') return apple ? '⇧' : 'Shift';
                if (key === 'enter') return '↵';
                if (key === 'space') return 'Space';
                if (key === 'escape') return 'Esc';
                if (key === 'left') return '←';
                if (key === 'right') return '→';
                return key.length === 1 ? key.toUpperCase() : key;
            })
            .join(apple ? '' : '+');
    };
    const formatOne = (shortcut: string) => {
        const press = parseShortcutPress(shortcut);
        if (!press) return shortcut;
        const label = formatChord(press.chord);
        return press.count === 2 ? `${label} ×2` : label;
    };
    return (typeof keys === 'string' ? [keys] : keys).map(formatOne).join(' / ');
}
