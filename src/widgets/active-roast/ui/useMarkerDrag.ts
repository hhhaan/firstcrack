import { useRef, type MutableRefObject } from 'react';
import type uPlot from 'uplot';

const HIT_PX = 8;

export const computeHitThreshSec = (u: uPlot): number => {
    const plotWidCss = u.bbox.width / devicePixelRatio;
    const xRange = ((u.scales.x as uPlot.Scale).max ?? 780) - ((u.scales.x as uPlot.Scale).min ?? 0);
    return (HIT_PX / plotWidCss) * xRange;
};

export const useMarkerDrag = (
    eventMarkersRef: MutableRefObject<Array<{ timeSec: number; event: string }>>,
    onDragRef: MutableRefObject<((event: string, newTimeSec: number) => void) | undefined>,
) => {
    const isDraggingRef = useRef(false);
    const isNearMarkerRef = useRef(false);
    const hoveredMarkerRef = useRef<string | null>(null);

    const setupDrag = (u: uPlot): (() => void) => {
        let dragEvent: string | null = null;
        let cachedOverRect: DOMRect | null = null;

        const onOverMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            const cx = u.cursor.left;
            if (cx == null) return;
            const cursorTimeSec = u.posToVal(cx, 'x');
            const thresh = computeHitThreshSec(u);
            for (const m of eventMarkersRef.current) {
                if (Math.abs(cursorTimeSec - m.timeSec) <= thresh) {
                    dragEvent = m.event;
                    isDraggingRef.current = true;
                    cachedOverRect = (u.over as HTMLElement).getBoundingClientRect();
                    (u.over as HTMLElement).style.cursor = 'ew-resize';
                    e.stopPropagation();
                    e.preventDefault();
                    return;
                }
            }
        };

        const onDocMouseMove = (e: MouseEvent) => {
            if (!dragEvent || !cachedOverRect) return;
            const cx = Math.max(0, Math.min(cachedOverRect.width, e.clientX - cachedOverRect.left));
            const newTimeSec = Math.max(0, Math.round(u.posToVal(cx, 'x')));
            onDragRef.current?.(dragEvent, newTimeSec);
        };

        const onDocMouseUp = () => {
            if (!dragEvent) return;
            (u.over as HTMLElement).style.cursor = '';
            dragEvent = null;
            cachedOverRect = null;
            isDraggingRef.current = false;
        };

        u.over.addEventListener('mousedown', onOverMouseDown);
        document.addEventListener('mousemove', onDocMouseMove);
        document.addEventListener('mouseup', onDocMouseUp);

        return () => {
            u.over.removeEventListener('mousedown', onOverMouseDown);
            document.removeEventListener('mousemove', onDocMouseMove);
            document.removeEventListener('mouseup', onDocMouseUp);
        };
    };

    return { isDraggingRef, isNearMarkerRef, hoveredMarkerRef, setupDrag };
};
