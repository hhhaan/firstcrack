import type { CSSProperties, PointerEvent, ReactNode, RefObject } from 'react';

interface ChartZoomSurfaceProps {
    chartAreaRef: RefObject<HTMLDivElement | null>;
    effectiveZoomRange: { start: number; end: number } | null;
    isChartDragging: boolean;
    handleChartPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    handleChartPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    endChartDrag: (event: PointerEvent<HTMLDivElement>) => void;
    className?: string;
    /** cursor class when not zoomed (live chart: 'cursor-default'; compare: none) */
    idleCursorClassName?: string;
    style?: CSSProperties;
    /** set → wraps in role="region" for AT; keep accurate to the surface's actual keys */
    ariaLabel?: string;
    children: ReactNode;
}

/**
 * The pointer/wheel interaction surface for a useChartZoom-driven chart.
 * Owns the grab/grabbing cursor state machine and the capture-phase pointer handlers
 * (wheel is a native listener bound inside useChartZoom — ECharts steals bubble wheel).
 */
export const ChartZoomSurface = ({
    chartAreaRef,
    effectiveZoomRange,
    isChartDragging,
    handleChartPointerDown,
    handleChartPointerMove,
    endChartDrag,
    className = '',
    idleCursorClassName = '',
    style,
    ariaLabel,
    children,
}: ChartZoomSurfaceProps) => {
    let cursor = idleCursorClassName;
    if (effectiveZoomRange) {
        cursor = isChartDragging ? 'cursor-grabbing select-none touch-none' : 'cursor-grab touch-none';
    }

    return (
        <div
            ref={chartAreaRef}
            className={`${className} ${cursor}`.trim()}
            style={style}
            onPointerDownCapture={handleChartPointerDown}
            onPointerMoveCapture={handleChartPointerMove}
            onPointerUpCapture={endChartDrag}
            onPointerCancelCapture={endChartDrag}
            onLostPointerCapture={endChartDrag}
            {...(ariaLabel ? { role: 'region', 'aria-label': ariaLabel } : {})}
        >
            {children}
        </div>
    );
};
