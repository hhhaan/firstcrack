import { resolveCurveColorCommit } from '@widgets/settings/lib/shouldCommitCurveColor';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const COMMIT_DELAY_MS = 120;

export const CurveStyleColorInput = ({
    value,
    themeFallback,
    label,
    onCommit,
}: {
    value: string | null;
    themeFallback: string;
    label: string;
    onCommit: (color: string | null) => void;
}) => {
    const [draft, setDraft] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRef = useRef<string | null>(null);
    const storedRef = useRef(value);
    const onCommitRef = useRef(onCommit);
    const themeRef = useRef(themeFallback);

    useLayoutEffect(() => {
        storedRef.current = value;
        onCommitRef.current = onCommit;
        themeRef.current = themeFallback;
    });

    const applyPending = (hex: string) => {
        const decision = resolveCurveColorCommit(hex, storedRef.current, themeRef.current);
        if (decision.kind === 'set') onCommitRef.current(decision.color);
    };

    const flushPending = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        const hex = pendingRef.current;
        pendingRef.current = null;
        setDraft(null);
        if (hex != null) applyPending(hex);
    };

    useEffect(
        () => () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            const hex = pendingRef.current;
            pendingRef.current = null;
            if (hex == null) return;
            const decision = resolveCurveColorCommit(hex, storedRef.current, themeRef.current);
            if (decision.kind === 'set') onCommitRef.current(decision.color);
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
            if (pending != null) applyPending(pending);
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
