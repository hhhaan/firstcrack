import { type KeyboardEvent, type PointerEvent, useRef } from 'react';

export type PanelResizeOptions = {
    width: number;
    min: number;
    max: number;
    /** When set, a drag lands on one of these widths instead of tracking the pointer. */
    stops?: readonly number[];
    onWidthChange: (width: number) => void;
};

const nearestStop = (stops: readonly number[], start: number, next: number) => {
    if (Math.abs(next - start) < 8) return start;
    if (next > start) return stops.find((stop) => stop > start) ?? start;
    return [...stops].reverse().find((stop) => stop < start) ?? start;
};

/** Resize a panel to the right of its divider. */
export const usePanelResize = ({ width, min, max, stops, onWidthChange }: PanelResizeOptions) => {
    const dragRef = useRef<{ x: number; width: number } | null>(null);
    const changeWidth = (next: number, start = width) =>
        onWidthChange(stops?.length ? nearestStop(stops, start, next) : Math.min(max, Math.max(min, next)));

    return {
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            dragRef.current = { x: event.clientX, width };
            event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
            if (!dragRef.current) return;
            changeWidth(dragRef.current.width + dragRef.current.x - event.clientX, dragRef.current.width);
        },
        onLostPointerCapture: () => {
            dragRef.current = null;
        },
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
            const nextStop = (direction: 1 | -1) =>
                direction > 0
                    ? (stops?.find((stop) => stop > width) ?? width)
                    : ([...(stops ?? [])].reverse().find((stop) => stop < width) ?? width);
            const next =
                event.key === 'Home'
                    ? (stops?.[0] ?? min)
                    : event.key === 'End'
                      ? (stops?.[stops.length - 1] ?? max)
                      : event.key === 'ArrowLeft'
                        ? stops?.length
                            ? nextStop(1)
                            : width + 10
                        : event.key === 'ArrowRight'
                          ? stops?.length
                              ? nextStop(-1)
                              : width - 10
                          : null;
            if (next === null) return;
            event.preventDefault();
            event.stopPropagation();
            changeWidth(next);
        },
    };
};
