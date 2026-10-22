import type { CSSProperties, PointerEvent, ReactNode, Ref } from 'react';

interface ChartZoomSurfaceProps {
    chartAreaRef: Ref<HTMLDivElement | null>;
    effectiveZoomRange: { start: number; end: number } | null;
    isChartDragging: boolean;
    handleChartPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    handleChartPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    endChartDrag: (event: PointerEvent<HTMLDivElement>) => void;
    className?: string;
    /** cursor class when not zoomed (live chart: 'cursor-default'; compare: none) */
    idleCursorClassName?: string;
    /** wins over grab/idle — marker hover/drag uses pointer */
    cursorOverrideClassName?: string;
    onPointerLeave?: () => void;
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
    cursorOverrideClassName,
    onPointerLeave,
    style,
    ariaLabel,
    children,
}: ChartZoomSurfaceProps) => {
    let cursor = idleCursorClassName;
    if (cursorOverrideClassName) {
        cursor = cursorOverrideClassName;
    } else if (effectiveZoomRange) {
        cursor = isChartDragging ? 'cursor-grabbing select-none touch-none' : 'cursor-grab touch-none';
    }

    return (
        <div
            ref={chartAreaRef}
            tabIndex={-1}
            className={`outline-none ${className} ${cursor}`.trim()}
            style={{ outline: 'none', ...style }}
            onPointerDownCapture={handleChartPointerDown}
            onPointerMoveCapture={handleChartPointerMove}
            onPointerMove={(event) => {
                if (!cursorOverrideClassName?.includes('cursor-pointer')) return;
                event.currentTarget.style.cursor = 'pointer';
                for (const canvas of event.currentTarget.querySelectorAll('canvas')) {
                    canvas.style.cursor = 'pointer';
                }
            }}
            onPointerUpCapture={endChartDrag}
            onPointerCancelCapture={endChartDrag}
            onLostPointerCapture={endChartDrag}
            onPointerLeave={onPointerLeave}
            {...(ariaLabel ? { role: 'region', 'aria-label': ariaLabel } : {})}
        >
            {children}
        </div>
    );
};
