import { CHART_GRID_LEFT, CHART_GRID_RIGHT } from '@features/active-roast/lib/chart-config';
import type { RefObject } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

/** 줌 시 보장하는 최소 표시 구간 (초) */
export const MIN_VISIBLE_SECS = 60;

const getChartDataWidth = (rect: DOMRect, rightPad: number) => Math.max(1, rect.width - CHART_GRID_LEFT - rightPad);

export interface ChartZoom {
    zoomRange: { start: number; end: number } | null;
    setZoomRange: React.Dispatch<React.SetStateAction<{ start: number; end: number } | null>>;
    /** zoomRange를 [0, MAX_TIME] 범위로 클램핑한 값. null이면 전체 범위 표시 */
    effectiveZoomRange: { start: number; end: number } | null;
    hoveredChartIndex: number | null;
    setHoveredChartIndex: React.Dispatch<React.SetStateAction<number | null>>;
    isChartDragging: boolean;
    mainChartHeight: number;
    chartAreaRef: RefObject<HTMLDivElement | null>;
    handleChartWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
    handleChartPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    handleChartPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    endChartDrag: (event: React.PointerEvent<HTMLDivElement>) => void;
}

/**
 * 온도 차트의 줌·패닝·드래그 상태와 인터랙션 핸들러를 관리한다.
 *
 * - 휠: 마우스 위치를 기준으로 줌 인/아웃
 * - 드래그: 줌된 상태에서 좌우 패닝
 * - ResizeObserver: chartAreaRef 크기 변화에 따라 mainChartHeight 갱신
 *
 * `zoomChart` / `panChart` / `handleChartKeyDown`은 visibleChartData에 의존해
 * 이 훅에서 분리할 수 없으므로 컴포넌트에 유지한다.
 *
 * @param MAX_TIME 현재 chartData의 마지막 시간(초). 줌 범위 클램핑에 사용.
 * @param minTime x축 최솟값(초). pre-charge 구간이 있을 때 음수. 기본값 0.
 * @param rightGridPad ECharts grid.right(px). 오른쪽 보조 Y축 있을 때 CHART_GRID_RIGHT_WITH_ROR.
 */
export const useChartZoom = (
    MAX_TIME: number,
    minTime: number = 0,
    rightGridPad: number = CHART_GRID_RIGHT,
): ChartZoom => {
    const [zoomRange, setZoomRange] = useState<{ start: number; end: number } | null>(null);
    const [hoveredChartIndex, setHoveredChartIndex] = useState<number | null>(null);
    const [isChartDragging, setIsChartDragging] = useState(false);
    const [mainChartHeight, setMainChartHeight] = useState(350);

    const chartAreaRef = useRef<HTMLDivElement>(null);
    const chartDragRef = useRef<{
        pointerId: number;
        startX: number;
        startRange: { start: number; end: number };
    } | null>(null);

    const effectiveZoomRange = useMemo(
        () =>
            zoomRange ? { start: Math.max(minTime, zoomRange.start), end: Math.min(MAX_TIME, zoomRange.end) } : null,
        [zoomRange, minTime, MAX_TIME],
    );

    // ECharts는 명시적 height(px)가 필요하므로 ResizeObserver로 chartAreaRef 높이를 그대로 반영한다.
    // ChartLegend는 absolute라 플로우 높이에 포함되지 않는다.
    useEffect(() => {
        const el = chartAreaRef.current;
        if (!el) return;
        const updateHeight = () => {
            setMainChartHeight(Math.max(180, el.offsetHeight));
        };
        updateHeight();
        const obs = new ResizeObserver(updateHeight);
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    const handleChartWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        if (MAX_TIME <= 0) return;
        event.preventDefault();
        const currentStart = effectiveZoomRange?.start ?? 0;
        const currentEnd = effectiveZoomRange?.end ?? MAX_TIME;
        const currentDuration = currentEnd - currentStart;
        if (event.deltaY < 0 && currentDuration <= MIN_VISIBLE_SECS) return;
        if (event.deltaY > 0 && currentStart === minTime && currentEnd === MAX_TIME) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const dataWidth = getChartDataWidth(rect, rightGridPad);
        const mouseX = event.clientX - rect.left - CHART_GRID_LEFT;
        const pointerRatio = dataWidth > 0 ? Math.max(0, Math.min(1, mouseX / dataWidth)) : 0.5;
        const focusTime = currentStart + pointerRatio * currentDuration;
        const zoomFactor = event.deltaY < 0 ? 0.8 : 1.25;
        const nextDuration = Math.max(MIN_VISIBLE_SECS, Math.min(MAX_TIME, currentDuration * zoomFactor));
        if (nextDuration >= MAX_TIME) {
            setZoomRange(null);
            return;
        }
        let nextStart = focusTime - pointerRatio * nextDuration;
        let nextEnd = nextStart + nextDuration;
        if (nextStart < minTime) {
            nextStart = minTime;
            nextEnd = minTime + nextDuration;
        }
        if (nextEnd > MAX_TIME) {
            nextEnd = MAX_TIME;
            nextStart = MAX_TIME - nextDuration;
        }
        setZoomRange({ start: nextStart, end: nextEnd });
    };

    const handleChartPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!effectiveZoomRange || event.button !== 0) return;
        chartDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startRange: effectiveZoomRange,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
        setIsChartDragging(true);
        event.preventDefault();
    };

    const handleChartPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = chartDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const duration = drag.startRange.end - drag.startRange.start;
        if (duration <= 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const dataWidth = getChartDataWidth(rect, rightGridPad);
        const deltaPx = event.clientX - drag.startX;
        const deltaTime = -(deltaPx / dataWidth) * duration;
        const nextStart = Math.max(minTime, Math.min(MAX_TIME - duration, drag.startRange.start + deltaTime));
        setZoomRange({ start: nextStart, end: nextStart + duration });
        event.preventDefault();
    };

    const endChartDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = chartDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        chartDragRef.current = null;
        setIsChartDragging(false);
    };

    return {
        zoomRange,
        setZoomRange,
        effectiveZoomRange,
        hoveredChartIndex,
        setHoveredChartIndex,
        isChartDragging,
        mainChartHeight,
        chartAreaRef,
        handleChartWheel,
        handleChartPointerDown,
        handleChartPointerMove,
        endChartDrag,
    };
};
