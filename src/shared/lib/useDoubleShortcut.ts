import { type PressArm, stepDoublePress } from '@shared/lib/double-press';
import { parseShortcutPress } from '@shared/lib/shortcut-key';
import { eventToShortcut } from '@shared/store/keyboard-shortcuts';
import { useEffect, useMemo, useRef } from 'react';

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

/**
 * Fires `onFire` on the second press of a double binding. Single chords stay on `useHotkeys`.
 * The first press is swallowed so a form does not take the key we are still counting.
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
        const down = (event: KeyboardEvent) => {
            const chord = eventToShortcut(event);
            if (!chord || !waiting.includes(chord)) return;
            if (event.target instanceof HTMLElement && event.target.isContentEditable) return;
            if (isFormTarget(event) && !enableOnFormTags) return;
            event.preventDefault();
            const next = stepDoublePress(sharedArm, { chord, edge: 'down', repeat: event.repeat, now: Date.now() });
            sharedArm = next.arm;
            if (next.fire) onFireRef.current(event);
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
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
        };
    }, [chordKey, enableOnFormTags, enabled]);
}
