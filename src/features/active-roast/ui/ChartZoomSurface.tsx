import type { CSSProperties, ReactNode } from 'react';
import type { ChartZoom } from '../model/useChartZoom';

/** useChartZoom outputs the interaction surface needs — the rest of ChartZoom (setZoomRange, height, keyboard refs) stays with the caller. */
type ZoomSurface = Pick<
    ChartZoom,
    | 'chartAreaRef'
    | 'effectiveZoomRange'
    | 'isChartDragging'
    | 'handleChartPointerDown'
    | 'handleChartPointerMove'
    | 'endChartDrag'
>;

interface ChartZoomSurfaceProps {
    zoom: ZoomSurface;
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
    zoom,
    className = '',
    idleCursorClassName = '',
    style,
    ariaLabel,
    children,
}: ChartZoomSurfaceProps) => {
    let cursor = idleCursorClassName;
    if (zoom.effectiveZoomRange) {
        cursor = zoom.isChartDragging ? 'cursor-grabbing select-none touch-none' : 'cursor-grab touch-none';
    }

    return (
        <div
            ref={zoom.chartAreaRef}
            className={`${className} ${cursor}`.trim()}
            style={style}
            onPointerDownCapture={zoom.handleChartPointerDown}
            onPointerMoveCapture={zoom.handleChartPointerMove}
            onPointerUpCapture={zoom.endChartDrag}
            onPointerCancelCapture={zoom.endChartDrag}
            {...(ariaLabel ? { role: 'region', 'aria-label': ariaLabel } : {})}
        >
            {children}
        </div>
    );
};
