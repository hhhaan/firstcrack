import { parseShortcut } from '@shared/lib/shortcut-key';

/** Gap that separates one press from a second press of the same chord. */
export const DOUBLE_PRESS_MS = 400;

export type PressEdge = 'down' | 'up';

export interface PressArm {
    chord: string;
    /** The chord's key went up after the first press. A held key's repeat is not a second press. */
    sawUp: boolean;
    at: number;
}

export interface PressStep {
    chord: string;
    edge: PressEdge;
    repeat?: boolean;
    now: number;
}

/**
 * One waiting chord. A second down of that chord fires only after its key was released
 * and only inside the window. Releasing Shift before Enter still counts: the key, not the
 * modifiers, has to come up. A later or different chord becomes the new first press.
 * The window expiring does not fire a single — the caller decides that.
 */
export function stepDoublePress(
    arm: PressArm | null,
    event: PressStep,
    windowMs = DOUBLE_PRESS_MS,
): { arm: PressArm | null; fire: boolean } {
    if (!event.chord) return { arm, fire: false };
    if (event.edge === 'up') {
        if (!arm) return { arm, fire: false };
        const waiting = parseShortcut(arm.chord)?.key;
        const released = parseShortcut(event.chord)?.key;
        if (!waiting || waiting !== released) return { arm, fire: false };
        return { arm: { ...arm, sawUp: true }, fire: false };
    }
    if (event.repeat) return { arm, fire: false };
    if (arm && arm.chord === event.chord && arm.sawUp && event.now - arm.at <= windowMs) {
        return { arm: null, fire: true };
    }
    return { arm: { chord: event.chord, sawUp: false, at: event.now }, fire: false };
}
