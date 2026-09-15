import type { EventMarkerStyle, PhaseSegment, TemperatureUnit, TurningPoint } from '@features/active-roast';
import {
    CONTROL_COLORS,
    getResolvedChartColors,
    ROR_Y_MAX,
    ROR_Y_MIN,
    TEMP_Y_MAX_C,
    TEMP_Y_MIN_C,
} from '@features/active-roast/lib/chart-config';
import {
    buildRoastChartOption,
    type ControlData,
    type RoastEventMarker,
} from '@features/active-roast/lib/chart-option';
import {
    eventLabelText,
    getMarkerLabelGeometry,
    LABEL_BELOW_EVENTS,
    nearestBtAt,
} from '@features/active-roast/lib/chart-option/markers';
import { formatTemp, toDisplayTemp } from '@features/active-roast/lib/temperature';
import { useThemeStore } from '@shared/store/theme';
import * as echarts from 'echarts';
import type React from 'react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

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
    onEventMarkerDrag?: (logId: string, newTimeSec: number) => void;
    onAddNote?: (body: string, timeSec: number) => void;
    showET?: boolean;
    showTargetCurve?: boolean;
    showTargetDeltaLabel?: boolean;
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

export interface RoastTempChartHandle {
    beginMarkerDrag: (event: Pick<PointerEvent, 'button' | 'clientX' | 'clientY' | 'pointerId'>) => boolean;
    moveMarkerDrag: (event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId'>) => boolean;
    endMarkerDrag: (pointerId: number) => boolean;
}

const scalar = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const RoastTempChart = forwardRef<RoastTempChartHandle, Props>(function RoastTempChart(
    {
        xs,
        btTarget,
        btActual,
        etActual,
        rorActual,
        currentTimeSec,
        charged = false,
        eventMarkerStyle = 'both',
        eventMarkers,
        turningPoints = [],
        temperatureUnit = 'C',
        height,
        onCursorIdx,
        onEventMarkerDrag,
        onAddNote,
        showET = true,
        showTargetCurve = true,
        showTargetDeltaLabel = false,
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
    },
    ref,
) {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstanceRef = useRef<echarts.ECharts | null>(null);
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

    const dragStateRef = useRef<{ pointerId: number; logId: string; timeSec: number } | null>(null);
    const PIXEL_THRESHOLD = 10;
    const lastChartSizeRef = useRef({ w: 0, h: 0 });
    const [noteForm, setNoteForm] = useState<{ x: number; y: number; timeSec: number } | null>(null);
    const [noteBody, setNoteBody] = useState('');
    const noteFormRef = useRef<HTMLFormElement>(null);

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
                showTargetDeltaLabel,
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
            showTargetDeltaLabel,
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

    const structureKey = [
        charged,
        eventMarkerStyle,
        eventMarkers.length,
        turningPoints.length,
        showET,
        showTargetCurve,
        showTargetDeltaLabel,
        showRoR,
        showRoRET,
        !!controlData,
        !!controlData?.heatSet?.some((value) => value != null),
        showControlDrum,
        showControlHeat,
        showControlFan,
        phaseSegments.length > 0,
        showFcBand,
        !!(targetXs?.length && targetBt?.length),
    ].join('|');
    const prevStructureKey = useRef(structureKey);
    useEffect(() => {
        const chart = chartInstanceRef.current;
        if (!chart) return;
        const structureChanged = prevStructureKey.current !== structureKey;
        prevStructureKey.current = structureKey;
        chart.setOption(option, { notMerge: structureChanged, lazyUpdate: !structureChanged });
    }, [option, structureKey]);

    useEffect(() => {
        const chart = chartInstanceRef.current;
        if (!chart || !onCursorIdx) return;
        const zr = chart.getZr();

        // biome-ignore lint/suspicious/noExplicitAny: ECharts event payload is loosely typed
        const handleMouseMove = (e: any) => {
            const x = scalar(chart.convertFromPixel({ xAxisIndex: 0 }, e.offsetX));
            if (x != null && xs.length && chart.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) {
                let nearestIdx = -1;
                let nearestDistance = Infinity;
                xs.forEach((value, index) => {
                    const distance = Math.abs(value - x);
                    if (Number.isFinite(distance) && distance < nearestDistance) {
                        nearestIdx = index;
                        nearestDistance = distance;
                    }
                });
                onCursorIdx(nearestIdx >= 0 ? nearestIdx : null);
            } else {
                onCursorIdx(null);
            }
        };

        zr.on('mousemove', handleMouseMove);
        const handleGlobalOut = () => onCursorIdx(null);
        zr.on('globalout', handleGlobalOut);
        return () => {
            zr.off('mousemove', handleMouseMove);
            zr.off('globalout', handleGlobalOut);
        };
    }, [xs, onCursorIdx]);

    const localPoint = useCallback((clientX: number, clientY: number) => {
        const rect = chartRef.current?.getBoundingClientRect();
        return rect ? { x: clientX - rect.left, y: clientY - rect.top } : null;
    }, []);

    const beginMarkerDrag = useCallback(
        (event: Pick<PointerEvent, 'button' | 'clientX' | 'clientY' | 'pointerId'>) => {
            if (event.button !== 0 || !onEventMarkerDrag) return false;
            const chart = chartInstanceRef.current;
            const point = localPoint(event.clientX, event.clientY);
            if (!chart || !point) return false;
            const xMin = xViewMin ?? xs[0] ?? 0;
            const xMax = xViewMax ?? xs[xs.length - 1] ?? currentTimeSec;

            const candidates = eventMarkers.flatMap((marker, index) => {
                if (!marker.logId || marker.event === 'Charge' || marker.event === 'Heater') return [];
                const x = scalar(chart.convertToPixel({ xAxisIndex: 0 }, marker.timeSec));
                if (x == null) return [];
                const rank = eventMarkers
                    .slice(0, index)
                    .filter((other) => Math.round(other.timeSec) === Math.round(marker.timeSec)).length;
                const nearest = nearestBtAt(xs, btActual, marker.timeSec);
                const displayY =
                    nearest ??
                    (marker.tempC != null && Number.isFinite(marker.tempC)
                        ? toDisplayTemp(marker.tempC, temperatureUnit)
                        : toDisplayTemp(tempMaxC, temperatureUnit));
                const anchorY = scalar(chart.convertToPixel({ yAxisIndex: 0 }, displayY)) ?? 20;
                const temp =
                    marker.tempC != null && Number.isFinite(marker.tempC)
                        ? formatTemp(marker.tempC, temperatureUnit)
                        : nearest != null
                          ? `${nearest.toFixed(1)}°${temperatureUnit}`
                          : marker.temp || '—';
                const text = eventLabelText(marker.event, marker.timeSec, temp, marker.note);
                const measuredWidth = Math.min(
                    240,
                    (() => {
                        const context = document.createElement('canvas').getContext('2d');
                        if (!context) return text.length * 6;
                        context.font = eventMarkerStyle === 'line' ? '700 11px monospace' : '600 10px monospace';
                        return context.measureText(text).width;
                    })(),
                );
                let labelX = x;
                let labelY = anchorY;
                let align: 'left' | 'right' | 'center' = 'center';
                if (eventMarkerStyle === 'both') {
                    const geometry = getMarkerLabelGeometry({
                        anchorX: x,
                        anchorY,
                        timeSec: marker.timeSec,
                        xMin,
                        xMax,
                        rank,
                        text,
                    });
                    labelX = geometry.x;
                    labelY = geometry.y;
                    align = geometry.align;
                } else if (eventMarkerStyle === 'point') {
                    labelY = anchorY + (LABEL_BELOW_EVENTS.has(marker.event) ? 12 : -12) - rank * 14;
                } else {
                    const below = LABEL_BELOW_EVENTS.has(marker.event);
                    labelY =
                        (scalar(
                            chart.convertToPixel(
                                { yAxisIndex: 0 },
                                toDisplayTemp(below ? tempMinC : tempMaxC, temperatureUnit),
                            ),
                        ) ?? (below ? (chartRef.current?.clientHeight ?? 0) : 0)) -
                        rank * 14;
                    const inward = xMax > xMin && (marker.timeSec - xMin) / (xMax - xMin) > 0.9;
                    labelX = x + (inward ? -4 : 4);
                    align = inward ? 'right' : 'left';
                }
                const labelLeft =
                    align === 'right'
                        ? labelX - measuredWidth
                        : align === 'center'
                          ? labelX - measuredWidth / 2
                          : labelX;
                const labelHit =
                    point.x >= labelLeft - 4 &&
                    point.x <= labelLeft + measuredWidth + 4 &&
                    Math.abs(point.y - labelY) <= 10;
                const plotHit = chart.containPixel({ gridIndex: [0, 1, 2] }, [point.x, point.y]);
                const pointHit =
                    eventMarkerStyle === 'point' &&
                    plotHit &&
                    Math.hypot(point.x - x, point.y - anchorY) <= PIXEL_THRESHOLD;
                const lineHit = eventMarkerStyle !== 'point' && plotHit && Math.abs(point.x - x) <= PIXEL_THRESHOLD;
                return labelHit || pointHit || lineHit
                    ? [
                          {
                              marker,
                              score: labelHit
                                  ? Math.abs(point.y - labelY)
                                  : 100 + Math.abs(point.y - labelY) / 100 + index / 10000,
                          },
                      ]
                    : [];
            });
            const selected = candidates.sort((a, b) => a.score - b.score)[0]?.marker;
            if (!selected?.logId) return false;
            dragStateRef.current = { pointerId: event.pointerId, logId: selected.logId, timeSec: selected.timeSec };
            return true;
        },
        [
            btActual,
            currentTimeSec,
            eventMarkerStyle,
            eventMarkers,
            localPoint,
            onEventMarkerDrag,
            tempMaxC,
            tempMinC,
            temperatureUnit,
            xViewMax,
            xViewMin,
            xs,
        ],
    );

    const moveMarkerDrag = useCallback(
        (event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId'>) => {
            const drag = dragStateRef.current;
            if (!drag || drag.pointerId !== event.pointerId || !onEventMarkerDrag) return false;
            const chart = chartInstanceRef.current;
            const point = localPoint(event.clientX, event.clientY);
            if (!chart || !point) return true;
            const converted = scalar(chart.convertFromPixel({ xAxisIndex: 0 }, point.x));
            if (converted == null) return true;
            const nextTimeSec = Math.max(0, Math.min(Math.floor(currentTimeSec), Math.round(converted)));
            if (nextTimeSec !== drag.timeSec) {
                onEventMarkerDrag(drag.logId, nextTimeSec);
                drag.timeSec = nextTimeSec;
            }
            return true;
        },
        [currentTimeSec, localPoint, onEventMarkerDrag],
    );

    const endMarkerDrag = useCallback((pointerId: number) => {
        if (dragStateRef.current?.pointerId !== pointerId) return false;
        dragStateRef.current = null;
        return true;
    }, []);

    useImperativeHandle(ref, () => ({ beginMarkerDrag, moveMarkerDrag, endMarkerDrag }), [
        beginMarkerDrag,
        moveMarkerDrag,
        endMarkerDrag,
    ]);

    useEffect(
        () => () => {
            dragStateRef.current = null;
        },
        [],
    );

    useEffect(() => {
        if (!onEventMarkerDrag) dragStateRef.current = null;
    }, [onEventMarkerDrag]);

    useEffect(() => {
        if (onAddNote) return;
        setNoteForm(null);
        setNoteBody('');
    }, [onAddNote]);

    useEffect(() => {
        if (!noteForm) return;
        const close = (event: globalThis.PointerEvent) => {
            if (!noteFormRef.current?.contains(event.target as Node)) {
                setNoteForm(null);
                setNoteBody('');
                chartRef.current?.focus();
            }
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [noteForm]);

    const handleContextMenu = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (!onAddNote) return;
            event.preventDefault();
            const chart = chartInstanceRef.current;
            const point = localPoint(event.clientX, event.clientY);
            const container = chartRef.current;
            if (!chart || !point || !container || !chart.containPixel({ gridIndex: 0 }, [point.x, point.y])) return;
            const converted = scalar(chart.convertFromPixel({ xAxisIndex: 0 }, point.x));
            if (converted == null) return;
            setNoteBody('');
            setNoteForm({
                x: Math.max(0, Math.min(point.x, container.clientWidth - 220)),
                y: Math.max(0, Math.min(point.y, container.clientHeight - 72)),
                timeSec: Math.max(0, Math.min(Math.floor(currentTimeSec), Math.round(converted))),
            });
        },
        [currentTimeSec, localPoint, onAddNote],
    );

    const submitNote = useCallback(() => {
        if (!noteForm || !noteBody.trim() || !onAddNote) return;
        onAddNote(noteBody.trim(), noteForm.timeSec);
        setNoteForm(null);
        setNoteBody('');
        chartRef.current?.focus();
    }, [noteBody, noteForm, onAddNote]);

    return (
        <div
            data-tour="active-roast-chart"
            style={{ position: 'relative', width: '100%', height: `${height}px`, minHeight: '300px' }}
        >
            <div
                ref={chartRef}
                tabIndex={-1}
                onContextMenu={handleContextMenu}
                style={{ width: '100%', height: '100%' }}
            />
            {noteForm && (
                <form
                    ref={noteFormRef}
                    data-chart-note-form
                    className="absolute z-20 flex w-[220px] gap-1 rounded border border-(--color-border) bg-(--color-surface) p-1 shadow-md"
                    style={{ left: noteForm.x, top: noteForm.y }}
                    onSubmit={(event) => {
                        event.preventDefault();
                        submitNote();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >
                    <label htmlFor="chart-note-input" className="sr-only">
                        Note
                    </label>
                    <textarea
                        id="chart-note-input"
                        autoFocus
                        rows={1}
                        value={noteBody}
                        onChange={(event) => setNoteBody(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                setNoteForm(null);
                                setNoteBody('');
                                chartRef.current?.focus();
                            } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                submitNote();
                            }
                        }}
                        className="min-w-0 flex-1 resize-none rounded border border-(--color-border) bg-transparent px-2 py-1 text-xs text-(--color-text-primary) outline-none"
                    />
                    <button type="submit" className="rounded px-2 text-xs text-(--color-text-primary)">
                        Add
                    </button>
                </form>
            )}
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
});
