import { DOUBLE_PRESS_MS, type PressArm, stepDoublePress } from '@shared/lib/double-press';
import { parseShortcutPress } from '@shared/lib/shortcut-key';
import { eventToShortcut, SHORTCUT_HOTKEY_OPTIONS, shortcutHotkeys } from '@shared/store/keyboard-shortcuts';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

/** Same targets react-hotkeys-hook skips unless `enableOnFormTags` is set. */
const FORM_TARGETS = new Set([
    'input',
    'textarea',
    'select',
    'searchbox',
    'slider',
    'spinbutton',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'radio',
    'textbox',
]);

const isFormTarget = (event: KeyboardEvent): boolean => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    const role = target.getAttribute('role')?.toLowerCase();
    return FORM_TARGETS.has(tag) || (role != null && FORM_TARGETS.has(role));
};

/**
 * One wait for every double binding. A different chord replaces it, so two actions cannot
 * both be halfway through a double. The OS Drop hook keeps its own wait: the focused window
 * delivers the same press twice, once from the OS and once from the webview.
 */
let sharedArm: PressArm | null = null;
const doubledChords = new Map<string, number>();
const doubledSubscribers = new Set<() => void>();
const pendingSingles = new Map<string, { timer: ReturnType<typeof setTimeout> }>();
const doubleEvents = new WeakSet<KeyboardEvent>();

export const isDoubleShortcutEvent = (event: KeyboardEvent): boolean => doubleEvents.has(event);

const snapshotDoubles = (): string => [...doubledChords.keys()].sort().join('\n');

const emitDoubles = (): void => {
    for (const notify of doubledSubscribers) notify();
};

const retainDoubleChord = (chord: string): void => {
    doubledChords.set(chord, (doubledChords.get(chord) ?? 0) + 1);
    emitDoubles();
};

const releaseDoubleChord = (chord: string): void => {
    const next = (doubledChords.get(chord) ?? 1) - 1;
    if (next <= 0) doubledChords.delete(chord);
    else doubledChords.set(chord, next);
    emitDoubles();
};

const cancelPendingSingle = (chord: string): void => {
    const pending = pendingSingles.get(chord);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingSingles.delete(chord);
};

const queuePendingSingle = (chord: string, fire: () => void): void => {
    cancelPendingSingle(chord);
    const timer = setTimeout(() => {
        pendingSingles.delete(chord);
        sharedArm = null;
        fire();
    }, DOUBLE_PRESS_MS);
    pendingSingles.set(chord, { timer });
};

/**
 * Fires `onFire` on the second press of a double binding. Single chords stay on `useHotkeys`
 * unless another action holds a double of the same chord, in which case the single waits.
 */
export function useDoubleShortcut(
    keys: readonly string[],
    onFire: (event: KeyboardEvent) => void,
    { enabled = true, enableOnFormTags = false }: { enabled?: boolean; enableOnFormTags?: boolean } = {},
): void {
    const onFireRef = useRef(onFire);
    useEffect(() => {
        onFireRef.current = onFire;
    }, [onFire]);
    const chords = useMemo(() => {
        const found: string[] = [];
        for (const key of keys) {
            const parsed = parseShortcutPress(key);
            if (parsed?.count === 2) found.push(parsed.chord);
        }
        return found;
    }, [keys]);
    const chordKey = chords.join('\n');

    useEffect(() => {
        if (!enabled || !chordKey) return;
        const waiting = chordKey.split('\n');
        for (const chord of waiting) retainDoubleChord(chord);
        const down = (event: KeyboardEvent) => {
            const chord = eventToShortcut(event);
            if (!chord || !waiting.includes(chord)) return;
            if (event.target instanceof HTMLElement && event.target.isContentEditable) return;
            if (isFormTarget(event) && !enableOnFormTags) return;
            event.preventDefault();
            const next = stepDoublePress(sharedArm, { chord, edge: 'down', repeat: event.repeat, now: Date.now() });
            sharedArm = next.arm;
            if (next.fire) {
                doubleEvents.add(event);
                cancelPendingSingle(chord);
                onFireRef.current(event);
            }
        };
        const up = (event: KeyboardEvent) => {
            const chord = eventToShortcut(event);
            if (!chord || !sharedArm) return;
            const armKey = sharedArm.chord;
            if (!waiting.includes(armKey) && !waiting.includes(chord)) return;
            sharedArm = stepDoublePress(sharedArm, { chord, edge: 'up', now: Date.now() }).arm;
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => {
            for (const chord of waiting) releaseDoubleChord(chord);
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
        };
    }, [chordKey, enableOnFormTags, enabled]);
}

type BoundShortcutOptions = {
    enabled?: boolean;
    enableOnFormTags?: boolean;
    enableOnContentEditable?: boolean;
    preventDefault?: boolean;
};

/**
 * Singles and doubles of one action. A single of a chord that another action
 * bound as a double waits `DOUBLE_PRESS_MS` so the two stay distinct.
 */
export function useBoundShortcut(
    keys: readonly string[],
    onFire: (event: KeyboardEvent) => void,
    options: BoundShortcutOptions = {},
    deps?: unknown[],
): void {
    const { enabled = true, enableOnFormTags = false, enableOnContentEditable = false, preventDefault } = options;
    const onFireRef = useRef(onFire);
    useEffect(() => {
        onFireRef.current = onFire;
    });
    useDoubleShortcut(keys, onFire, { enabled, enableOnFormTags });
    const doubled = useSyncExternalStore(
        (notify) => {
            doubledSubscribers.add(notify);
            return () => doubledSubscribers.delete(notify);
        },
        snapshotDoubles,
        snapshotDoubles,
    );
    const { immediate, delayed } = useMemo(() => {
        const held = new Set(doubled.split('\n').filter(Boolean));
        const nextImmediate: string[] = [];
        const nextDelayed: string[] = [];
        for (const key of keys) {
            const parsed = parseShortcutPress(key);
            if (parsed?.count !== 1) continue;
            if (held.has(parsed.chord)) nextDelayed.push(parsed.chord);
            else nextImmediate.push(key);
        }
        return { immediate: nextImmediate, delayed: nextDelayed };
    }, [doubled, keys]);
    const immediateHotkey = shortcutHotkeys(immediate);
    useHotkeys(
        immediateHotkey,
        (event) => {
            onFire(event);
        },
        {
            ...SHORTCUT_HOTKEY_OPTIONS,
            enabled: enabled && immediateHotkey.length > 0,
            enableOnFormTags,
            enableOnContentEditable,
            preventDefault,
        },
        deps,
    );
    const delayedKey = delayed.join('\n');
    useEffect(() => {
        if (!enabled || !delayedKey) return;
        const waiting = delayedKey.split('\n');
        const down = (event: KeyboardEvent) => {
            const chord = eventToShortcut(event);
            if (!chord || !waiting.includes(chord) || event.repeat) return;
            if (doubleEvents.has(event)) return;
            if (event.target instanceof HTMLElement && event.target.isContentEditable && !enableOnContentEditable)
                return;
            if (isFormTarget(event) && !enableOnFormTags) return;
            if (sharedArm && sharedArm.chord === chord && sharedArm.sawUp) {
                cancelPendingSingle(chord);
                return;
            }
            event.preventDefault();
            const captured = event;
            queuePendingSingle(chord, () => onFireRef.current(captured));
        };
        window.addEventListener('keydown', down);
        return () => {
            window.removeEventListener('keydown', down);
            for (const chord of waiting) cancelPendingSingle(chord);
        };
    }, [delayedKey, enableOnContentEditable, enableOnFormTags, enabled]);
}
