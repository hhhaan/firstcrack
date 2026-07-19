import type { EventMarkerStyle, PhaseSegment, TemperatureUnit, TurningPoint } from '@features/active-roast';
import {
    CONTROL_COLORS,
    getResolvedChartColors,
    ROR_Y_MAX,
    ROR_Y_MIN,
    TEMP_Y_MAX_C,
    TEMP_Y_MIN_C,
} from '@features/active-roast/lib/chart-config';
import { useThemeStore } from '@shared/store/theme';
import * as echarts from 'echarts';
import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { buildRoastChartOption, type ControlData, type RoastEventMarker } from '../lib/chart-option';

export type { RoastEventMarker };

interface Props {
    xs: number[];
    btTarget: (number | null)[];
    btActual: (number | null)[];
    etActual: (number | null)[];
    rorActual: (number | null)[];
    currentTimeSec: number;
    charged?: boolean;
    eventMarkerStyle?: EventMarkerStyle;
    eventMarkers: RoastEventMarker[];
    turningPoints?: TurningPoint[];
    temperatureUnit?: TemperatureUnit;
    height: number;
    onCursorIdx?: (idx: number | null) => void;
    onEventMarkerDrag?: (event: string, newTimeSec: number) => void;
    showET?: boolean;
    showTargetCurve?: boolean;
    targetXs?: number[];
    targetBt?: (number | null)[];
    showRoR?: boolean;
    showRoRET?: boolean;
    rorEtActual?: (number | null)[];
    controlData?: ControlData;
    showControlDrum?: boolean;
    showControlHeat?: boolean;
    showControlFan?: boolean;
    controlChartHeightPct?: number;
    controlYMin?: number;
    controlYMax?: number;
    phaseSegments?: PhaseSegment[];
    showFcBand?: boolean;
    tempMinC?: number;
    tempMaxC?: number;
    rorYMin?: number;
    rorYMax?: number;
    xViewMin?: number;
    xViewMax?: number;
}

export const RoastTempChart: React.FC<Props> = ({
    xs,
    btTarget,
    btActual,
    etActual,
    rorActual,
    currentTimeSec,
    charged = false,
    eventMarkerStyle = 'point',
    eventMarkers,
    turningPoints = [],
    temperatureUnit = 'C',
    height,
    onCursorIdx,
    onEventMarkerDrag,
    showET = true,
    showTargetCurve = true,
    targetXs,
    targetBt,
    showRoR = true,
    showRoRET = false,
    rorEtActual = [],
    controlData,
    showControlDrum = true,
    showControlHeat = true,
    showControlFan = true,
    controlChartHeightPct = 21,
    controlYMin = 0,
    controlYMax = 100,
    phaseSegments = [],
    showFcBand = true,
    tempMinC = TEMP_Y_MIN_C,
    tempMaxC = TEMP_Y_MAX_C,
    rorYMin = ROR_Y_MIN,
    rorYMax = ROR_Y_MAX,
    xViewMin,
    xViewMax,
}) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstanceRef = useRef<echarts.ECharts | null>(null);
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

    const dragStateRef = useRef<{
        active: boolean;
        eventName: string;
        startX: number;
        startTimeSec: number;
    } | null>(null);
    const PIXEL_THRESHOLD = 10;
    const lastChartSizeRef = useRef({ w: 0, h: 0 });

    useEffect((): (() => void) | undefined => {
        const container = chartRef.current;
        if (!container) return undefined;

        const chart = echarts.init(container, undefined, {
            renderer: 'canvas',
            useDirtyRect: false,
        });
        chartInstanceRef.current = chart;

        const resizeObserver = new ResizeObserver(() => {
            const w = container.offsetWidth;
            const h = container.offsetHeight;
            if (w <= 0 || h <= 0) return;
            const last = lastChartSizeRef.current;
            if (last.w === w && last.h === h) return;
            lastChartSizeRef.current = { w, h };
            chart.resize();
        });
        resizeObserver.observe(container);

        return () => {
            resizeObserver.disconnect();
            if (chartInstanceRef.current) {
                chartInstanceRef.current.dispose();
                chartInstanceRef.current = null;
            }
        };
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    const option = useMemo(
        () =>
            buildRoastChartOption({
                xs,
                btTarget,
                btActual,
                etActual,
                rorActual,
                currentTimeSec,
                charged,
                eventMarkerStyle,
                eventMarkers,
                turningPoints,
                temperatureUnit,
                showET,
                showTargetCurve,
                targetXs,
                targetBt,
                showRoR,
                showRoRET,
                rorEtActual,
                controlData,
                showControlDrum,
                showControlHeat,
                showControlFan,
                controlChartHeightPct,
                controlYMin,
                controlYMax,
                phaseSegments,
                showFcBand,
                tempMinC,
                tempMaxC,
                rorYMin,
                rorYMax,
                xViewMin,
                xViewMax,
                colors: getResolvedChartColors(),
            }),
        [
            xs,
            btTarget,
            targetXs,
            targetBt,
            btActual,
            etActual,
            rorActual,
            currentTimeSec,
            charged,
            eventMarkerStyle,
            eventMarkers,
            turningPoints,
            temperatureUnit,
            showET,
            showTargetCurve,
            showRoR,
            showRoRET,
            rorEtActual,
            controlData,
            showControlDrum,
            showControlHeat,
            showControlFan,
            controlChartHeightPct,
            controlYMin,
            controlYMax,
            phaseSegments,
            showFcBand,
            resolvedTheme,
            tempMinC,
            tempMaxC,
            rorYMin,
            rorYMax,
            xViewMin,
            xViewMax,
        ],
    );

    const prevHasControlData = useRef(!!controlData);
    const prevHasPhaseBar = useRef(phaseSegments.length > 0);
    const prevHasTargetData = useRef(!!(targetXs?.length && targetBt?.length));
    const prevEventMarkerStyle = useRef(eventMarkerStyle);
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    useEffect(() => {
        const chart = chartInstanceRef.current;
        if (!chart) return;
        const hasPhaseBar = phaseSegments.length > 0;
        const hasTargetData = !!(targetXs?.length && targetBt?.length);
        const structureChanged =
            prevHasControlData.current !== !!controlData ||
            prevHasPhaseBar.current !== hasPhaseBar ||
            prevHasTargetData.current !== hasTargetData ||
            prevEventMarkerStyle.current !== eventMarkerStyle;
        prevHasControlData.current = !!controlData;
        prevHasPhaseBar.current = hasPhaseBar;
        prevHasTargetData.current = hasTargetData;
        prevEventMarkerStyle.current = eventMarkerStyle;
        chart.setOption(option, { notMerge: structureChanged, lazyUpdate: !structureChanged });
    }, [option]);

    useEffect(() => {
        const chart = chartInstanceRef.current;
        if (!chart || !onCursorIdx) return;

        // biome-ignore lint/suspicious/noExplicitAny: ECharts event payload is loosely typed
        const handleMouseMove = (e: any) => {
            const pixel: [number, number] = [e.offsetX, e.offsetY];
            const point = chart.convertFromPixel({ xAxisIndex: 0 }, pixel);
            if (point && xs.length) {
                const idx = xs.reduce(
                    (prev, curr, i) => (Math.abs(curr - point[0]) < Math.abs(xs[prev] - point[0]) ? i : prev),
                    0,
                );
                onCursorIdx(idx);
            }
        };

        chart.on('mousemove', handleMouseMove);
        const handleGlobalOut = () => onCursorIdx(null);
        chart.on('globalout', handleGlobalOut);
        return () => {
            chart.off('mousemove', handleMouseMove);
            chart.off('globalout', handleGlobalOut);
        };
    }, [xs, onCursorIdx]);

    useEffect(() => {
        const chart = chartInstanceRef.current;
        if (!chart || !onEventMarkerDrag) return;

        const zr = chart.getZr();
        if (!zr) return;

        const handleZrPointerDown = (e: Record<string, unknown>) => {
            if (!chart) return;
            const evt = e.event as MouseEvent | undefined;
            const mx = evt?.offsetX ?? (e.offsetX as number);
            if (mx == null) return;
            const yMid = chart.convertToPixel({ yAxisIndex: 0 }, 150) ?? 200;
            for (const marker of eventMarkers) {
                if (marker.event === 'Charge') continue;
                const pixel = chart.convertToPixel({ xAxisIndex: 0 }, [marker.timeSec, yMid]);
                if (pixel == null) continue;
                const px = Array.isArray(pixel) ? pixel[0] : pixel;
                const dist = Math.abs(mx - px);
                if (dist <= PIXEL_THRESHOLD) {
                    dragStateRef.current = {
                        active: true,
                        eventName: marker.event,
                        startX: mx,
                        startTimeSec: marker.timeSec,
                    };
                    break;
                }
            }
        };

        const handleZrPointerMove = (e: Record<string, unknown>) => {
            const ds = dragStateRef.current;
            if (!ds?.active || !chart) return;
            const evt = e.event as MouseEvent | undefined;
            const mx = evt?.offsetX ?? (e.offsetX as number);
            const my = evt?.offsetY ?? (e.offsetY as number);
            if (mx == null) return;
            const point = chart.convertFromPixel({ xAxisIndex: 0 }, [mx, my]);
            if (!point) return;
            const xVal = Array.isArray(point) ? point[0] : point;
            const clamped = Math.max(0, Math.round(xVal));
            if (clamped !== ds.startTimeSec) {
                onEventMarkerDrag(ds.eventName, clamped);
                dragStateRef.current = { ...ds, startTimeSec: clamped };
            }
        };

        const handleZrPointerUp = () => {
            if (dragStateRef.current) {
                dragStateRef.current = null;
            }
        };

        zr.on('mousedown', handleZrPointerDown);
        zr.on('mousemove', handleZrPointerMove);
        zr.on('mouseup', handleZrPointerUp);

        return () => {
            zr.off('mousedown', handleZrPointerDown);
            zr.off('mousemove', handleZrPointerMove);
            zr.off('mouseup', handleZrPointerUp);
        };
    }, [eventMarkers, onEventMarkerDrag]);

    return (
        <div
            data-tour="active-roast-chart"
            style={{ position: 'relative', width: '100%', height: `${height}px`, minHeight: '300px' }}
        >
            <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
            {controlData && (showControlDrum || showControlHeat || showControlFan) && (
                <div className="absolute flex items-center gap-4" style={{ bottom: -15, left: 25 }}>
                    {[
                        ...(showControlDrum ? [{ color: CONTROL_COLORS.drum, label: 'Drum' }] : []),
                        ...(showControlHeat ? [{ color: CONTROL_COLORS.heat, label: 'Heat' }] : []),
                        ...(showControlFan ? [{ color: CONTROL_COLORS.fan, label: 'Fan' }] : []),
                    ].map((item) => (
                        <div key={item.label} className="flex items-center gap-1.5">
                            <div style={{ width: 16, height: 2, background: item.color }} />
                            <span className="text-[11px] text-muted tracking-[0.14px]">{item.label}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
