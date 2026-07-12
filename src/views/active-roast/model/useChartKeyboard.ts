import type { RefObject } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { MIN_VISIBLE_SECS } from './useChartZoom';

interface UseChartKeyboardParams {
    isActive: boolean;
    showEndRoastModal: boolean;
    showSummaryModal: boolean;
    minTime: number;
    maxTime: number;
    /** 현재 줌 범위 (null = 전체) */
    zoomRange: { start: number; end: number } | null;
    setZoomRange: (range: { start: number; end: number } | null) => void;
    /** 줌/패닝 중심 계산용 — 현재 가시 영역 데이터 */
    visibleChartData: { time: number }[];
    hoveredChartIndexRef: RefObject<number | null>;
}

export const useChartKeyboard = ({
    isActive,
    showEndRoastModal,
    showSummaryModal,
    minTime,
    maxTime,
    zoomRange,
    setZoomRange,
    visibleChartData,
    hoveredChartIndexRef,
}: UseChartKeyboardParams) => {
    const chartKeysEnabled = isActive && !showEndRoastModal && !showSummaryModal;

    const zoomChart = (zoomFactor: number) => {
        if (maxTime <= 0) return;
        const currentStart = zoomRange?.start ?? minTime;
        const currentEnd = zoomRange?.end ?? maxTime;
        const currentDuration = currentEnd - currentStart;
        const nextDuration = Math.max(MIN_VISIBLE_SECS, Math.min(maxTime - minTime, currentDuration * zoomFactor));
        if (nextDuration >= maxTime - minTime) {
            setZoomRange(null);
            return;
        }
        const hoveredChartIndex = hoveredChartIndexRef.current;
        const focusTime =
            hoveredChartIndex != null
                ? (visibleChartData[hoveredChartIndex]?.time ?? (currentStart + currentEnd) / 2)
                : (currentStart + currentEnd) / 2;
        const ratio = currentDuration > 0 ? (focusTime - currentStart) / currentDuration : 0.5;
        let nextStart = focusTime - ratio * nextDuration;
        let nextEnd = nextStart + nextDuration;
        if (nextStart < minTime) {
            nextStart = minTime;
            nextEnd = minTime + nextDuration;
        }
        if (nextEnd > maxTime) {
            nextEnd = maxTime;
            nextStart = maxTime - nextDuration;
        }
        setZoomRange({ start: nextStart, end: nextEnd });
    };

    const panChart = (direction: -1 | 1) => {
        if (!zoomRange) return;
        const duration = zoomRange.end - zoomRange.start;
        const step = Math.max(1, duration * 0.2);
        const nextStart = Math.max(minTime, Math.min(maxTime - duration, zoomRange.start + step * direction));
        setZoomRange({ start: nextStart, end: nextStart + duration });
    };

    useHotkeys(
        '+, =',
        (e) => {
            e.preventDefault();
            zoomChart(0.8);
        },
        { enabled: chartKeysEnabled },
        [chartKeysEnabled, maxTime, zoomChart],
    );

    useHotkeys(
        '-, _',
        (e) => {
            e.preventDefault();
            zoomChart(1.25);
        },
        { enabled: chartKeysEnabled },
        [chartKeysEnabled, maxTime, zoomChart],
    );

    useHotkeys(
        '0',
        (e) => {
            e.preventDefault();
            setZoomRange(null);
        },
        { enabled: chartKeysEnabled },
        [chartKeysEnabled, setZoomRange],
    );

    useHotkeys(
        'left',
        (e) => {
            e.preventDefault();
            panChart(-1);
        },
        { enabled: chartKeysEnabled },
        [chartKeysEnabled, panChart],
    );

    useHotkeys(
        'right',
        (e) => {
            e.preventDefault();
            panChart(1);
        },
        { enabled: chartKeysEnabled },
        [chartKeysEnabled, panChart],
    );
};
