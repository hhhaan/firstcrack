import { useCallback, useEffect, useRef, useState } from 'react';

/** Leading edge. The first call runs; further calls wait out the interval. */
export const createLeadingGate = (intervalMs: number, now: () => number = Date.now) => {
    let last = Number.NEGATIVE_INFINITY;
    return () => {
        const at = now();
        if (at - last < intervalMs) return false;
        last = at;
        return true;
    };
};

/** Locks the control for the interval after a press that is allowed through. */
export const useLeadingLock = (intervalMs: number) => {
    const gate = useRef(createLeadingGate(intervalMs));
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [locked, setLocked] = useState(false);
    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        [],
    );
    const run = useCallback(
        (action: () => void) => {
            if (!gate.current()) return;
            setLocked(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setLocked(false), intervalMs);
            action();
        },
        [intervalMs],
    );
    return { locked, run };
};
