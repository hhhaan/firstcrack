import { type KeyboardEvent, type PointerEvent, useRef } from 'react';

export type PanelResizeOptions = {
    width: number;
    min: number;
    max: number;
    onWidthChange: (width: number) => void;
};

/** Resize a panel to the right of its divider. */
export const usePanelResize = ({ width, min, max, onWidthChange }: PanelResizeOptions) => {
    const dragRef = useRef<{ x: number; width: number } | null>(null);
    const changeWidth = (next: number) => onWidthChange(Math.min(max, Math.max(min, next)));

    return {
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            dragRef.current = { x: event.clientX, width };
            event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
            if (dragRef.current) changeWidth(dragRef.current.width + dragRef.current.x - event.clientX);
        },
        onLostPointerCapture: () => {
            dragRef.current = null;
        },
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
            const next =
                event.key === 'Home'
                    ? min
                    : event.key === 'End'
                      ? max
                      : event.key === 'ArrowLeft'
                        ? width + 10
                        : event.key === 'ArrowRight'
                          ? width - 10
                          : null;
            if (next === null) return;
            event.preventDefault();
            event.stopPropagation();
            changeWidth(next);
        },
    };
};
