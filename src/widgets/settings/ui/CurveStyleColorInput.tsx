import { useEffect, useRef, useState } from 'react';

const COMMIT_DELAY_MS = 120;

/** Commits only when `hex` differs from the stored custom color (`stored`). */
export const shouldCommitCurveColor = (hex: string, stored: string | null): boolean => stored !== hex;

export const CurveStyleColorInput = ({
    value,
    themeFallback,
    label,
    onCommit,
}: {
    value: string | null;
    themeFallback: string;
    label: string;
    onCommit: (color: string) => void;
}) => {
    const [draft, setDraft] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRef = useRef<string | null>(null);
    const storedRef = useRef(value);
    storedRef.current = value;
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;

    const flushPending = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        const hex = pendingRef.current;
        pendingRef.current = null;
        setDraft(null);
        if (hex != null && shouldCommitCurveColor(hex, storedRef.current)) {
            onCommitRef.current(hex);
        }
    };

    useEffect(
        () => () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            const hex = pendingRef.current;
            pendingRef.current = null;
            if (hex != null && shouldCommitCurveColor(hex, storedRef.current)) {
                onCommitRef.current(hex);
            }
        },
        [],
    );

    const schedule = (hex: string) => {
        setDraft(hex);
        pendingRef.current = hex;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            const pending = pendingRef.current;
            pendingRef.current = null;
            timerRef.current = null;
            setDraft(null);
            if (pending != null && shouldCommitCurveColor(pending, storedRef.current)) {
                onCommitRef.current(pending);
            }
        }, COMMIT_DELAY_MS);
    };

    return (
        <input
            type="color"
            value={draft ?? value ?? themeFallback}
            aria-label={label}
            onChange={(event) => schedule(event.currentTarget.value)}
            onBlur={() => flushPending()}
            className="h-8 w-10 cursor-pointer rounded-md border border-border-subtle bg-transparent p-0.5"
        />
    );
};
