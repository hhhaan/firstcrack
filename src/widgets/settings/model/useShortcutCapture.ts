import { DOUBLE_PRESS_MS, type PressArm, stepDoublePress } from '@shared/lib/double-press';
import { doubleShortcut } from '@shared/lib/shortcut-key';
import { eventToShortcut } from '@shared/store/keyboard-shortcuts';
import { useEffect, useRef, useState } from 'react';

export type ShortcutCaptureDecision = 'accept' | 'reject';

/**
 * Records one chord or a double. The first accepted chord waits `DOUBLE_PRESS_MS`.
 * The same chord again saves the double. The wait ending saves the single.
 * A different chord starts over. Escape cancels.
 */
export function useShortcutCapture({
    active,
    onCandidate,
    onCommit,
    onCancel,
}: {
    active: boolean;
    onCandidate: (chord: string) => ShortcutCaptureDecision;
    onCommit: (shortcut: string) => void;
    onCancel: () => void;
}): string | null {
    const onCandidateRef = useRef(onCandidate);
    const onCommitRef = useRef(onCommit);
    const onCancelRef = useRef(onCancel);
    const [draft, setDraft] = useState<string | null>(null);

    useEffect(() => {
        onCandidateRef.current = onCandidate;
        onCommitRef.current = onCommit;
        onCancelRef.current = onCancel;
    }, [onCandidate, onCommit, onCancel]);

    useEffect(() => {
        if (!active) {
            setDraft(null);
            return;
        }
        let arm: PressArm | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const clearTimer = () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
        };
        const onKeyDown = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.isComposing) return;
            if (event.key === 'Escape') {
                clearTimer();
                arm = null;
                setDraft(null);
                onCancelRef.current();
                return;
            }
            if (event.repeat) return;
            const chord = eventToShortcut(event);
            if (!chord) return;
            if (onCandidateRef.current(chord) === 'reject') {
                clearTimer();
                arm = null;
                setDraft(null);
                return;
            }
            const next = stepDoublePress(arm, { chord, edge: 'down', now: Date.now() });
            arm = next.arm;
            if (next.fire) {
                clearTimer();
                setDraft(null);
                onCommitRef.current(doubleShortcut(chord));
                return;
            }
            setDraft(chord);
            clearTimer();
            timer = setTimeout(() => {
                arm = null;
                timer = undefined;
                setDraft(null);
                onCommitRef.current(chord);
            }, DOUBLE_PRESS_MS);
        };
        const onKeyUp = (event: KeyboardEvent) => {
            const chord = eventToShortcut(event);
            if (!chord || !arm) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            arm = stepDoublePress(arm, { chord, edge: 'up', now: Date.now() }).arm;
        };
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('keyup', onKeyUp, true);
        return () => {
            clearTimer();
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('keyup', onKeyUp, true);
        };
    }, [active]);

    return draft;
}
