import { useCallback, useEffect, useRef } from 'react';

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
    const fromPointer = useRef(false);

    useEffect(() => {
        actionRef.current = action;
        startRef.current = onStart;
    });

    const clear = useCallback(() => {
        if (timers.current.delay != null) clearTimeout(timers.current.delay);
        if (timers.current.interval != null) clearInterval(timers.current.interval);
        timers.current = {};
    }, []);

    useEffect(() => clear, [clear]);

    const onPointerDown = useCallback(() => {
        if (disabled) return;
        fromPointer.current = true;
        startRef.current?.();
        actionRef.current();
        timers.current.delay = setTimeout(() => {
            timers.current.interval = setInterval(() => actionRef.current(), HOLD_INTERVAL_MS);
        }, HOLD_DELAY_MS);
    }, [disabled]);

    const onClick = useCallback(() => {
        if (disabled) return;
        if (fromPointer.current) {
            fromPointer.current = false;
            return;
        }
        startRef.current?.();
        actionRef.current();
    }, [disabled]);

    return { onPointerDown, onPointerUp: clear, onPointerLeave: clear, onPointerCancel: clear, onClick };
};
