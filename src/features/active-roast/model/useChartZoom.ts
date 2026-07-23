import { CHART_GRID_LEFT, CHART_GRID_RIGHT } from '@features/active-roast/lib/chart-config';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** 줌 시 보장하는 최소 표시 구간 (초) */
export const MIN_VISIBLE_SECS = 60;

const getChartDataWidth = (rect: DOMRect, rightPad: number) => Math.max(1, rect.width - CHART_GRID_LEFT - rightPad);

export interface ChartZoom {
    zoomRange: { start: number; end: number } | null;
    setZoomRange: React.Dispatch<React.SetStateAction<{ start: number; end: number } | null>>;
    /** zoomRange를 [minTime, MAX_TIME] 범위로 클램핑한 값. null이면 전체 범위 표시 */
    effectiveZoomRange: { start: number; end: number } | null;
    /** 키보드 줌 중심 — 호버마다 리렌더하지 않도록 ref로 유지 */
    hoveredChartIndexRef: RefObject<number | null>;
    setHoveredChartIndex: (index: number | null) => void;
    isChartDragging: boolean;
    mainChartHeight: number;
    chartAreaRef: RefObject<HTMLDivElement | null>;
    handleChartPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    handleChartPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    endChartDrag: (event: React.PointerEvent<HTMLDivElement>) => void;
}

/**
 * 온도 차트의 줌·패닝·드래그 상태와 인터랙션 핸들러를 관리한다.
 *
 * - 휠: native non-passive listener (ECharts canvas가 bubble wheel을 막음)
 * - 드래그: 줌된 상태에서 X축 좌우 패닝만 (Y 구간은 설정값 고정)
 */
export const useChartZoom = (
    MAX_TIME: number,
    minTime: number = 0,
    rightGridPad: number = CHART_GRID_RIGHT,
    /** false면 휠 줌 비활성 */
    wheelEnabled: boolean = true,
): ChartZoom => {
    const [zoomRange, setZoomRange] = useState<{ start: number; end: number } | null>(null);
    const hoveredChartIndexRef = useRef<number | null>(null);
    const setHoveredChartIndex = useCallback((index: number | null) => {
        hoveredChartIndexRef.current = index;
    }, []);
    const [isChartDragging, setIsChartDragging] = useState(false);
    const [mainChartHeight, setMainChartHeight] = useState(350);

    const chartAreaRef = useRef<HTMLDivElement>(null);
    const chartDragRef = useRef<{
        pointerId: number;
        startX: number;
        startRange: { start: number; end: number };
    } | null>(null);

    // Latest values for native wheel listener (avoid re-bind every render)
    const zoomRef = useRef({
        MAX_TIME,
        minTime,
        rightGridPad,
        zoomRange,
        wheelEnabled,
    });
    useEffect(() => {
        zoomRef.current = { MAX_TIME, minTime, rightGridPad, zoomRange, wheelEnabled };
    }, [MAX_TIME, minTime, rightGridPad, zoomRange, wheelEnabled]);

    const effectiveZoomRange = useMemo(
        () =>
            zoomRange ? { start: Math.max(minTime, zoomRange.start), end: Math.min(MAX_TIME, zoomRange.end) } : null,
        [zoomRange, minTime, MAX_TIME],
    );

    useEffect(() => {
        const el = chartAreaRef.current;
        if (!el) return;
        const updateHeight = () => {
            if (el.offsetHeight <= 0) return;
            const nextHeight = Math.max(180, el.offsetHeight);
            setMainChartHeight((prev) => (prev === nextHeight ? prev : nextHeight));
        };
        updateHeight();
        const obs = new ResizeObserver(updateHeight);
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    // Native wheel — capture + passive:false so preventDefault works and ECharts can't swallow it.
    // Re-bind when height settles (ref is attached after first layout).
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    useEffect(() => {
        const el = chartAreaRef.current;
        if (!el) return;

        const onWheel = (event: WheelEvent) => {
            const {
                MAX_TIME: maxT,
                minTime: minT,
                rightGridPad: pad,
                zoomRange: zr,
                wheelEnabled: enabled,
            } = zoomRef.current;
            if (!enabled || maxT <= minT) return;

            event.preventDefault();
            event.stopPropagation();

            const currentStart = zr ? Math.max(minT, zr.start) : minT;
            const currentEnd = zr ? Math.min(maxT, zr.end) : maxT;
            const currentDuration = currentEnd - currentStart;
            if (currentDuration <= 0) return;

            // zoom in (deltaY < 0) / out (deltaY > 0)
            if (event.deltaY < 0 && currentDuration <= MIN_VISIBLE_SECS) return;
            if (event.deltaY > 0 && !zr) return; // already full range

            const rect = el.getBoundingClientRect();
            const dataWidth = getChartDataWidth(rect, pad);
            const mouseX = event.clientX - rect.left - CHART_GRID_LEFT;
            const pointerRatio = dataWidth > 0 ? Math.max(0, Math.min(1, mouseX / dataWidth)) : 0.5;
            const focusTime = currentStart + pointerRatio * currentDuration;
            const zoomFactor = event.deltaY < 0 ? 0.8 : 1.25;
            const fullSpan = maxT - minT;
            const nextDuration = Math.max(MIN_VISIBLE_SECS, Math.min(fullSpan, currentDuration * zoomFactor));

            if (nextDuration >= fullSpan - 1e-6) {
                setZoomRange(null);
                return;
            }

            let nextStart = focusTime - pointerRatio * nextDuration;
            let nextEnd = nextStart + nextDuration;
            if (nextStart < minT) {
                nextStart = minT;
                nextEnd = minT + nextDuration;
            }
            if (nextEnd > maxT) {
                nextEnd = maxT;
                nextStart = maxT - nextDuration;
            }
            setZoomRange({ start: nextStart, end: nextEnd });
        };

        el.addEventListener('wheel', onWheel, { passive: false, capture: true });
        return () => el.removeEventListener('wheel', onWheel, { capture: true });
    }, [mainChartHeight]);

    const handleChartPointerDown = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (!effectiveZoomRange || event.button !== 0) return;
            if (chartDragRef.current) return;
            chartDragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startRange: effectiveZoomRange,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus();
            setIsChartDragging(true);
            event.preventDefault();
        },
        [effectiveZoomRange],
    );

    const handleChartPointerMove = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
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
        },
        [MAX_TIME, minTime, rightGridPad],
    );

    const endChartDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const drag = chartDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        chartDragRef.current = null;
        setIsChartDragging(false);
    }, []);

    return {
        zoomRange,
        setZoomRange,
        effectiveZoomRange,
        hoveredChartIndexRef,
        setHoveredChartIndex,
        isChartDragging,
        mainChartHeight,
        chartAreaRef,
        handleChartPointerDown,
        handleChartPointerMove,
        endChartDrag,
    };
};
