import { useState, useRef, useEffect } from 'react';
import type { RefObject } from 'react';

/** 줌 시 보장하는 최소 표시 구간 (초) */
export const MIN_VISIBLE_SECS = 60;

/** uPlot 레이아웃과 맞춘 Y축 여백·오른쪽 패딩 */
const Y_AXIS_WIDTH = 36;
const RIGHT_PAD = 12;

const getChartDataWidth = (rect: DOMRect) => Math.max(1, rect.width - Y_AXIS_WIDTH - RIGHT_PAD);

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
 */
export const useChartZoom = (MAX_TIME: number): ChartZoom => {
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

    const effectiveZoomRange = zoomRange
        ? { start: Math.max(0, zoomRange.start), end: Math.min(MAX_TIME, zoomRange.end) }
        : null;

    // uPlot이 height를 JS로 강제 설정하므로 flex-1 방식 대신 ResizeObserver로 높이를 계산한다.
    // ChartLegend는 absolute(0px 플로우), phase pill(~22px) + mb-3(12px) ≈ 36px를 뺀다.
    useEffect(() => {
        const el = chartAreaRef.current;
        if (!el) return;
        const obs = new ResizeObserver(() => {
            setMainChartHeight(Math.max(180, el.offsetHeight - 36));
        });
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
        if (event.deltaY > 0 && currentStart === 0 && currentEnd === MAX_TIME) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const dataWidth = rect.width - Y_AXIS_WIDTH - RIGHT_PAD;
        const mouseX = event.clientX - rect.left - Y_AXIS_WIDTH;
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
        if (nextStart < 0) {
            nextStart = 0;
            nextEnd = nextDuration;
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
        const dataWidth = getChartDataWidth(rect);
        const deltaPx = event.clientX - drag.startX;
        const deltaTime = -(deltaPx / dataWidth) * duration;
        const nextStart = Math.max(0, Math.min(MAX_TIME - duration, drag.startRange.start + deltaTime));
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
