import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef } from 'react';

export const HOLD_DELAY_MS = 400;
export const HOLD_INTERVAL_MS = 100;

/**
 * pointerdown에서 한 번 실행하고, 누르고 있으면 반복.
 * click()만 오는 테스트/키보드 활성화는 onClick이 받고,
 * 실제 포인터는 pointerdown이 이미 실행했으므로 click을 건너뛴다.
 */
export const useHoldRepeat = (action: () => void, disabled: boolean, onStart?: () => void) => {
    const actionRef = useRef(action);
    const startRef = useRef(onStart);
    const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval> }>({});

    useEffect(() => {
        actionRef.current = action;
        startRef.current = onStart;
    });

    const clear = useCallback(() => {
        if (timers.current.delay != null) clearTimeout(timers.current.delay);
        if (timers.current.interval != null) clearInterval(timers.current.interval);
        timers.current = {};
    }, []);

    useEffect(() => {
        if (disabled) clear();
        return clear;
    }, [clear, disabled]);

    const onPointerDown = useCallback(
        (event: PointerEvent) => {
            if (disabled || event.button !== 0) return;
            clear();
            startRef.current?.();
            actionRef.current();
            timers.current.delay = setTimeout(() => {
                timers.current.interval = setInterval(() => actionRef.current(), HOLD_INTERVAL_MS);
            }, HOLD_DELAY_MS);
        },
        [clear, disabled],
    );

    const onClick = useCallback(
        (event: MouseEvent) => {
            // Pointer clicks were handled on pointerdown; keyboard/assistive clicks have detail 0.
            if (disabled || event.detail > 0) return;
            startRef.current?.();
            actionRef.current();
        },
        [disabled],
    );

    return { onPointerDown, onPointerUp: clear, onPointerLeave: clear, onPointerCancel: clear, onClick };
};
