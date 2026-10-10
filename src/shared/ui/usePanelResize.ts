import { type KeyboardEvent, type PointerEvent, useRef } from 'react';

export type PanelResizeOptions = {
    width: number;
    min: number;
    max: number;
    onWidthChange: (width: number) => void;
    /** Pointer moves call this instead of `onWidthChange`. The release commits through `onWidthChange`. */
    onWidthPreview?: (width: number) => void;
};

/** Resize a panel to the right of its divider. */
export const usePanelResize = ({ width, min, max, onWidthChange, onWidthPreview }: PanelResizeOptions) => {
    const dragRef = useRef<{ x: number; width: number; live: number | null } | null>(null);
    const clamp = (next: number) => Math.min(max, Math.max(min, next));

    return {
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            dragRef.current = { x: event.clientX, width, live: null };
            event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
            const drag = dragRef.current;
            if (!drag) return;
            const next = clamp(drag.width + drag.x - event.clientX);
            drag.live = next;
            if (onWidthPreview) onWidthPreview(next);
            else onWidthChange(next);
        },
        onLostPointerCapture: () => {
            const drag = dragRef.current;
            dragRef.current = null;
            if (drag?.live != null && onWidthPreview) onWidthChange(drag.live);
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
            onWidthChange(clamp(next));
        },
    };
};
