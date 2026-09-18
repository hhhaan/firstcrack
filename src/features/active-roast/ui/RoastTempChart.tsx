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
    LABEL_BELOW_EVENTS,
    layoutCurveLabelBoxes,
    nearestBtAt,
} from '@features/active-roast/lib/chart-option/markers';
import { REMOVABLE_LOG_EVENTS } from '@features/active-roast/lib/constants';
import { formatTemp, toDisplayTemp } from '@features/active-roast/lib/temperature';
import { formatElapsed } from '@shared/lib/format';
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
    onEventMarkerEdit?: (logId: string, patch: { timeSec?: number; note?: string }) => void;
    onEventMarkerDelete?: (logId: string) => void;
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
    bbpRange?: { start: number; end: number };
    hideChargeLabel?: boolean;
}

export interface RoastTempChartHandle {
    beginMarkerDrag: (event: Pick<PointerEvent, 'button' | 'clientX' | 'clientY' | 'pointerId'>) => boolean;
    moveMarkerDrag: (event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId'>) => boolean;
    endMarkerDrag: (pointerId: number) => boolean;
    hitTestMarker: (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => boolean;
    openMarkerEdit: (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => boolean;
}

const scalar = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Typing: digits + optional `:ss`. Seconds 0–60. */
const EDIT_TIME_INPUT_RE = /^\d{0,3}(?::(?:[0-5]?\d?|60)?)?$/;
const EDIT_TIME_PARSE_RE = /^(\d{1,3}):([0-5]?\d|60)$/;

const parseEditTimeSec = (raw: string): number | null => {
    const match = raw.trim().match(EDIT_TIME_PARSE_RE);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
};

const parseHeaterNote = (note: string): { value: string; unit: string } => {
    const match = note.trim().match(/^(-?\d+(?:\.\d+)?)(.*)$/);
    return match ? { value: match[1], unit: match[2] || '%' } : { value: '', unit: '%' };
};

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
        onEventMarkerEdit,
        onEventMarkerDelete,
        onAddNote,
        hideChargeLabel = false,
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
        bbpRange,
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
    const [editForm, setEditForm] = useState<{
        logId: string;
        event: string;
        x: number;
        y: number;
        time: string;
        note: string;
        heaterUnit: string;
    } | null>(null);
    const editFormRef = useRef<HTMLFormElement>(null);

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
                bbpRange,
                hideChargeLabel,
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
            bbpRange,
            hideChargeLabel,
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
        !!bbpRange,
        hideChargeLabel,
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

    const findDraggableMarker = useCallback(
        (clientX: number, clientY: number) => {
            if (!onEventMarkerDrag && !onEventMarkerEdit) return null;
            const chart = chartInstanceRef.current;
            const point = localPoint(clientX, clientY);
            if (!chart || !point) return null;
            const layoutInputs = [
                ...eventMarkers.flatMap((marker) => {
                    if (hideChargeLabel && marker.event === 'Charge') return [];
                    const x = scalar(chart.convertToPixel({ xAxisIndex: 0 }, marker.timeSec));
                    const nearest = nearestBtAt(xs, btActual, marker.timeSec);
                    const displayY =
                        nearest ??
                        (marker.tempC != null && Number.isFinite(marker.tempC)
                            ? toDisplayTemp(marker.tempC, temperatureUnit)
                            : toDisplayTemp(tempMaxC, temperatureUnit));
                    const y = scalar(chart.convertToPixel({ yAxisIndex: 0 }, displayY));
                    const temp =
                        marker.tempC != null && Number.isFinite(marker.tempC)
                            ? formatTemp(marker.tempC, temperatureUnit)
                            : nearest != null
                              ? `${nearest.toFixed(1)}°${temperatureUnit}`
                              : marker.temp || '—';
                    return [
                        {
                            marker,
                            timeSec: marker.timeSec,
                            xPx: x ?? Number.NaN,
                            yPx: y ?? Number.NaN,
                            text: eventLabelText(marker.event, marker.timeSec, temp, marker.note),
                            below: LABEL_BELOW_EVENTS.has(marker.event),
                            color: '',
                            showDot: eventMarkerStyle === 'point',
                        },
                    ];
                }),
                ...turningPoints.map((tp) => {
                    const x = scalar(chart.convertToPixel({ xAxisIndex: 0 }, tp.timeSec));
                    const displayY = nearestBtAt(xs, btActual, tp.timeSec) ?? toDisplayTemp(tp.temp, temperatureUnit);
                    const y = scalar(chart.convertToPixel({ yAxisIndex: 0 }, displayY));
                    return {
                        marker: null as RoastEventMarker | null,
                        timeSec: tp.timeSec,
                        xPx: x ?? Number.NaN,
                        yPx: y ?? Number.NaN,
                        text: eventLabelText('TP', tp.timeSec, formatTemp(tp.temp, temperatureUnit)),
                        below: true,
                        color: '',
                        showDot: eventMarkerStyle === 'point',
                    };
                }),
            ];
            const boxes = layoutCurveLabelBoxes(layoutInputs);
            const candidates = layoutInputs.flatMap((input, index) => {
                const marker = input.marker;
                if (!marker?.logId || marker.event === 'Charge') return [];
                const x = input.xPx;
                const anchorY = input.yPx;
                if (!Number.isFinite(x)) return [];
                const box = boxes[index];
                const labelHit = Boolean(
                    box &&
                        point.x >= box.left - 4 &&
                        point.x <= box.right + 4 &&
                        point.y >= box.top - 4 &&
                        point.y <= box.bottom + 4,
                );
                const plotHit = chart.containPixel({ gridIndex: [0, 1, 2] }, [point.x, point.y]);
                const pointHit =
                    eventMarkerStyle === 'point' &&
                    plotHit &&
                    Number.isFinite(anchorY) &&
                    Math.hypot(point.x - x, point.y - anchorY) <= PIXEL_THRESHOLD;
                const lineHit = eventMarkerStyle !== 'point' && plotHit && Math.abs(point.x - x) <= PIXEL_THRESHOLD;
                const labelY = box?.textY ?? anchorY;
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
            return candidates.sort((a, b) => a.score - b.score)[0]?.marker ?? null;
        },
        [
            btActual,
            eventMarkerStyle,
            eventMarkers,
            hideChargeLabel,
            localPoint,
            onEventMarkerDrag,
            onEventMarkerEdit,
            tempMaxC,
            temperatureUnit,
            turningPoints,
            xs,
        ],
    );

    const beginMarkerDrag = useCallback(
        (event: Pick<PointerEvent, 'button' | 'clientX' | 'clientY' | 'pointerId'>) => {
            if (event.button !== 0) return false;
            const selected = findDraggableMarker(event.clientX, event.clientY);
            if (!selected?.logId) return false;
            dragStateRef.current = { pointerId: event.pointerId, logId: selected.logId, timeSec: selected.timeSec };
            return true;
        },
        [findDraggableMarker],
    );

    const hitTestMarker = useCallback(
        (event: Pick<PointerEvent, 'clientX' | 'clientY'>) =>
            Boolean(findDraggableMarker(event.clientX, event.clientY)),
        [findDraggableMarker],
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

    const openMarkerEdit = useCallback(
        (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
            if (!onEventMarkerEdit) return false;
            const selected = findDraggableMarker(event.clientX, event.clientY);
            const point = localPoint(event.clientX, event.clientY);
            const container = chartRef.current;
            if (!selected?.logId || !point || !container) return false;
            const heater = parseHeaterNote(selected.note ?? '');
            setNoteForm(null);
            setNoteBody('');
            setEditForm({
                logId: selected.logId,
                event: selected.event,
                x: Math.max(0, Math.min(point.x, container.clientWidth - 220)),
                y: Math.max(0, Math.min(point.y, container.clientHeight - 120)),
                time: formatElapsed(selected.timeSec),
                note: selected.event === 'Heater' ? heater.value : (selected.note ?? ''),
                heaterUnit: heater.unit,
            });
            return true;
        },
        [findDraggableMarker, localPoint, onEventMarkerEdit],
    );

    useImperativeHandle(
        ref,
        () => ({ beginMarkerDrag, moveMarkerDrag, endMarkerDrag, hitTestMarker, openMarkerEdit }),
        [beginMarkerDrag, moveMarkerDrag, endMarkerDrag, hitTestMarker, openMarkerEdit],
    );

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
        if (onEventMarkerEdit) return;
        setEditForm(null);
    }, [onEventMarkerEdit]);

    useEffect(() => {
        if (!noteForm && !editForm) return;
        const close = (event: globalThis.PointerEvent) => {
            const target = event.target as Node;
            if (noteFormRef.current?.contains(target) || editFormRef.current?.contains(target)) return;
            setNoteForm(null);
            setNoteBody('');
            setEditForm(null);
            chartRef.current?.focus();
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [editForm, noteForm]);

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
            setEditForm(null);
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

    const submitEdit = useCallback(() => {
        if (!editForm || !onEventMarkerEdit) return;
        const timeSec = parseEditTimeSec(editForm.time);
        if (timeSec == null) return;
        const patch: { timeSec: number; note?: string } = {
            timeSec: Math.max(0, Math.min(Math.floor(currentTimeSec), timeSec)),
        };
        if (editForm.event === 'Heater') {
            const heat = Number(editForm.note);
            if (!Number.isFinite(heat)) return;
            patch.note = `${Math.round(heat)}${editForm.heaterUnit}`;
        } else if (editForm.event === 'Note') {
            const body = editForm.note.trim();
            if (!body) return;
            patch.note = body;
        }
        onEventMarkerEdit(editForm.logId, patch);
        setEditForm(null);
        chartRef.current?.focus();
    }, [currentTimeSec, editForm, onEventMarkerEdit]);

    const deleteEdit = useCallback(() => {
        if (!editForm || !onEventMarkerDelete || !REMOVABLE_LOG_EVENTS.has(editForm.event)) return;
        onEventMarkerDelete(editForm.logId);
        setEditForm(null);
        chartRef.current?.focus();
    }, [editForm, onEventMarkerDelete]);

    return (
        <div
            data-tour="active-roast-chart"
            style={{ position: 'relative', width: '100%', height: `${height}px`, minHeight: '300px' }}
        >
            <div
                ref={chartRef}
                tabIndex={-1}
                onContextMenu={handleContextMenu}
                className="outline-none"
                style={{ width: '100%', height: '100%', outline: 'none' }}
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
            {editForm && (
                <form
                    ref={editFormRef}
                    data-chart-marker-edit
                    className="absolute z-20 flex w-[220px] flex-col gap-1 rounded border border-(--color-border) bg-(--color-surface) p-1.5 shadow-md"
                    style={{ left: editForm.x, top: editForm.y }}
                    onSubmit={(event) => {
                        event.preventDefault();
                        submitEdit();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >
                    <div className="px-1 text-[11px] font-medium text-(--color-text-primary)">{editForm.event}</div>
                    <label className="flex items-center gap-1 px-1 text-[11px] text-muted">
                        Time
                        <input
                            id="chart-marker-time"
                            autoFocus
                            inputMode="numeric"
                            pattern="\d{1,3}:([0-5]?\d|60)"
                            maxLength={6}
                            value={editForm.time}
                            onChange={(event) => {
                                const next = event.target.value;
                                if (!EDIT_TIME_INPUT_RE.test(next)) {
                                    event.target.value = editForm.time;
                                    return;
                                }
                                setEditForm({ ...editForm, time: next });
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setEditForm(null);
                                    chartRef.current?.focus();
                                }
                            }}
                            className="min-w-0 flex-1 rounded border border-(--color-border) bg-transparent px-2 py-1 font-mono text-xs text-(--color-text-primary) outline-none"
                        />
                    </label>
                    {editForm.event === 'Heater' && (
                        <label className="flex items-center gap-1 px-1 text-[11px] text-muted">
                            Heat
                            <input
                                id="chart-marker-heat"
                                type="number"
                                value={editForm.note}
                                onChange={(event) => setEditForm({ ...editForm, note: event.target.value })}
                                className="min-w-0 flex-1 rounded border border-(--color-border) bg-transparent px-2 py-1 font-mono text-xs text-(--color-text-primary) outline-none"
                            />
                            <span className="font-mono text-[11px]">{editForm.heaterUnit}</span>
                        </label>
                    )}
                    {editForm.event === 'Note' && (
                        <label className="flex items-center gap-1 px-1 text-[11px] text-muted">
                            Note
                            <textarea
                                id="chart-marker-note"
                                rows={1}
                                value={editForm.note}
                                onChange={(event) => setEditForm({ ...editForm, note: event.target.value })}
                                className="min-w-0 flex-1 resize-none rounded border border-(--color-border) bg-transparent px-2 py-1 text-xs text-(--color-text-primary) outline-none"
                            />
                        </label>
                    )}
                    <div className="flex items-center justify-end gap-1">
                        {onEventMarkerDelete && REMOVABLE_LOG_EVENTS.has(editForm.event) && (
                            <button
                                type="button"
                                data-chart-marker-delete
                                onClick={deleteEdit}
                                className="rounded px-2 text-xs text-muted"
                            >
                                Delete
                            </button>
                        )}
                        <button type="submit" className="rounded px-2 text-xs text-(--color-text-primary)">
                            Save
                        </button>
                    </div>
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
