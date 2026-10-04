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
import { computeTempYRange } from '@features/active-roast/lib/chart-option/axes';
import {
    eventLabelText,
    isCurveMarkerVisible,
    isEventMarkerVisible,
    LABEL_BELOW_EVENTS,
    layoutCurveLabelBoxes,
    nearestBtAt,
    noteAnchoredAtTop,
    noteLabelTopInsetPx,
} from '@features/active-roast/lib/chart-option/markers';
import { REMOVABLE_LOG_EVENTS } from '@features/active-roast/lib/constants';
import type { EventMarkerPatch } from '@features/active-roast/lib/event-marker-drag';
import { formatRoastNote } from '@features/active-roast/lib/roast-note';
import { formatTemp, toDisplayTemp } from '@features/active-roast/lib/temperature';
import { type RoastSettings, useRoastSettings } from '@features/active-roast/model/settings';
import { roastEventLabel } from '@shared/i18n/roast-event-label';
import { formatElapsed } from '@shared/lib/format';
import { logger } from '@shared/lib/logger';
import { applyTimeEdit, parseEditTime, type TimeEditKind } from '@shared/lib/time-edit';
import { useThemeStore } from '@shared/store/theme';
import type { RoastNoteControls } from '@shared/types/roast';
import * as echarts from 'echarts';
import type React from 'react';
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { RoastNoteFields, type RoastNoteValues } from './RoastNoteFields';

export type { RoastEventMarker };

const emptyNote: RoastNoteValues = { gas: '', airflow: '', note: '' };

type ChartAxisInput = Pick<
    RoastSettings,
    | 'tempGridInterval'
    | 'tempGridPresetInterval'
    | 'tempLabelPresetEvery'
    | 'timeTickPresetSec'
    | 'tempAxisMode'
    | 'tempTickMode'
    | 'tempTicksC'
    | 'tempLabelEvery'
    | 'timeTickIntervalSec'
    | 'tempLabelCustom'
    | 'timeTickCustom'
>;

const usesCustomTickList = (settings: Pick<ChartAxisInput, 'tempAxisMode' | 'tempTickMode' | 'tempTicksC'>): boolean =>
    settings.tempAxisMode === 'list' && settings.tempTickMode === 'list' && settings.tempTicksC.length > 0;

const gridIntervalFor = (settings: ChartAxisInput): number => {
    if (settings.tempAxisMode === 'preset') return settings.tempGridPresetInterval;
    if (settings.tempTickMode === 'interval') return settings.tempGridInterval;
    return 10;
};

const labelEveryFor = (settings: ChartAxisInput): number => {
    if (settings.tempAxisMode === 'list' && settings.tempTickMode === 'list') return 5;
    if (settings.tempLabelCustom) return settings.tempLabelEvery;
    return settings.tempLabelPresetEvery;
};

const chartAxisSettings = (settings: ChartAxisInput) => ({
    tempGridInterval: gridIntervalFor(settings),
    tempTicksC: settings.tempAxisMode === 'list' && settings.tempTickMode === 'list' ? settings.tempTicksC : [],
    tempLabelEvery: labelEveryFor(settings),
    timeTickIntervalSec: settings.timeTickCustom ? settings.timeTickIntervalSec : settings.timeTickPresetSec,
});

interface Props {
    report?: boolean;
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
    onEventMarkerEdit?: (logId: string, patch: EventMarkerPatch) => void;
    onEventMarkerDelete?: (logId: string) => void;
    onAddNote?: (body: string, timeSec: number, controls?: RoastNoteControls) => void;
    showET?: boolean;
    showTargetCurve?: boolean;
    showProfileBt?: boolean;
    showProfileEt?: boolean;
    showProfileRor?: boolean;
    showProfileDrum?: boolean;
    showProfileHeat?: boolean;
    showProfileFan?: boolean;
    showTargetDeltaLabel?: boolean;
    targetXs?: number[];
    targetBt?: (number | null)[];
    targetEt?: (number | null)[];
    targetRor?: (number | null)[];
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
    bbpRange?: { start: number; end: number; label?: string };
    hideChargeLabel?: boolean;
}

export interface RoastTempChartHandle {
    beginMarkerDrag: (event: Pick<PointerEvent, 'button' | 'clientX' | 'clientY' | 'pointerId'>) => boolean;
    moveMarkerDrag: (event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId'>) => boolean;
    endMarkerDrag: (pointerId: number) => boolean;
    hitTestMarker: (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => boolean;
    openMarkerEdit: (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => boolean;
    getDataURL: (size?: { width: number; height: number; pixelRatio?: number }) => string | null;
}

const scalar = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Notes can sit ahead of the live curve, up to the axis end. Other events stop at now. */
const clampMarkerTime = (event: string, timeSec: number, nowSec: number, axisMaxSec: number) => {
    const cap = event === 'Note' ? axisMaxSec : Math.floor(nowSec);
    return Math.max(0, Math.min(cap, Math.round(timeSec)));
};

const parseHeaterNote = (note: string): { value: string; unit: string } => {
    const match = note.trim().match(/^(-?\d+(?:\.\d+)?)(.*)$/);
    return match ? { value: match[1], unit: match[2] || '%' } : { value: '', unit: '%' };
};

/** Omitted profile flags stay on. Kept off the component so each default is not a branch there. */
const profileShown = (flag: boolean | undefined): boolean => flag !== false;

const seriesPresent = (values: readonly (number | null)[] | undefined): number =>
    values?.some((value) => value != null) ? 1 : 0;

/** Structure identity for setOption notMerge. Branches stay off the chart component. */
const chartStructureKey = (input: {
    report: boolean;
    charged: boolean;
    eventMarkerStyle: string;
    eventMarkerCount: number;
    turningPointCount: number;
    showET: boolean;
    showTargetCurve: boolean;
    showTargetDeltaLabel: boolean;
    showRoR: boolean;
    showRoRET: boolean;
    hasControlData: boolean;
    hasHeatSet: boolean;
    showControlDrum: boolean;
    showControlHeat: boolean;
    showControlFan: boolean;
    hasPhaseSegments: boolean;
    showFcBand: boolean;
    targetXs: number[] | undefined;
    targetBt: (number | null)[] | undefined;
    targetEt: (number | null)[] | undefined;
    targetRor: (number | null)[] | undefined;
    referenceHeater: (number | null)[] | undefined;
    referenceFan: (number | null)[] | undefined;
    referenceDrum: (number | null)[] | undefined;
    hasBbpRange: boolean;
    hideChargeLabel: boolean;
    fontScale: number;
}): string =>
    [
        input.report,
        input.charged,
        input.eventMarkerStyle,
        input.eventMarkerCount,
        input.turningPointCount,
        input.showET,
        input.showTargetCurve,
        input.showTargetDeltaLabel,
        input.showRoR,
        input.showRoRET,
        input.hasControlData,
        input.hasHeatSet,
        input.showControlDrum,
        input.showControlHeat,
        input.showControlFan,
        input.hasPhaseSegments,
        input.showFcBand,
        !!(input.targetXs?.length && input.targetBt?.length),
        seriesPresent(input.targetEt),
        seriesPresent(input.targetRor),
        seriesPresent(input.referenceHeater),
        seriesPresent(input.referenceFan),
        seriesPresent(input.referenceDrum),
        input.hasBbpRange,
        input.hideChargeLabel,
        input.fontScale,
    ].join('|');

const controlLegendItems = (
    controlData: ControlData | undefined,
    drum: boolean,
    heat: boolean,
    fan: boolean,
): { color: string; label: string }[] => {
    if (!controlData || (!drum && !heat && !fan)) return [];
    return [
        ...(drum ? [{ color: CONTROL_COLORS.drum, label: 'Drum' }] : []),
        ...(heat ? [{ color: CONTROL_COLORS.heat, label: 'Heat' }] : []),
        ...(fan ? [{ color: CONTROL_COLORS.fan, label: 'Fan' }] : []),
    ];
};

export const RoastTempChart = forwardRef<RoastTempChartHandle, Props>(function RoastTempChart(
    {
        report = false,
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
        showProfileBt,
        showProfileEt,
        showProfileRor,
        showProfileDrum,
        showProfileHeat,
        showProfileFan,
        showTargetDeltaLabel = false,
        targetXs,
        targetBt,
        targetEt,
        targetRor,
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
    const profileBt = profileShown(showProfileBt);
    const profileEt = profileShown(showProfileEt);
    const profileRor = profileShown(showProfileRor);
    const profileDrum = profileShown(showProfileDrum);
    const profileHeat = profileShown(showProfileHeat);
    const profileFan = profileShown(showProfileFan);
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstanceRef = useRef<echarts.ECharts | null>(null);
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
    const roastSettings = useRoastSettings();
    const fontScale = roastSettings.fontScalePct / 100;
    const axisSettings = useMemo(() => chartAxisSettings(roastSettings), [roastSettings]);
    const yRangeInterval = usesCustomTickList(roastSettings) ? undefined : axisSettings.tempGridInterval;

    const dragStateRef = useRef<{ pointerId: number; logId: string; timeSec: number } | null>(null);
    const PIXEL_THRESHOLD = 10;
    const lastChartSizeRef = useRef({ w: 0, h: 0 });
    const [noteForm, setNoteForm] = useState<{ x: number; y: number; timeSec: number } | null>(null);
    const { t } = useTranslation();
    const [noteValues, setNoteValues] = useState<RoastNoteValues>(emptyNote);
    const noteFormRef = useRef<HTMLFormElement>(null);
    const [editForm, setEditForm] = useState<{
        logId: string;
        event: string;
        x: number;
        y: number;
        time: string;
        note: string;
        gas: string;
        airflow: string;
        heaterUnit: string;
    } | null>(null);
    const editFormRef = useRef<HTMLFormElement>(null);
    const timeInputRef = useRef<HTMLInputElement>(null);
    const timeSuppress = useRef(false);
    const timeCaret = useRef<number | null>(null);
    const timeBypassLogged = useRef(false);

    useLayoutEffect(() => {
        const form = noteFormRef.current ?? editFormRef.current;
        const position = noteForm ?? editForm;
        const container = chartRef.current;
        if (!form || !position || !container) return;
        const reposition = () => {
            form.style.left = `${Math.max(0, Math.min(position.x, container.clientWidth - form.offsetWidth))}px`;
            form.style.top = `${Math.max(0, Math.min(position.y, container.clientHeight - form.offsetHeight))}px`;
        };
        reposition();
        const observer = new ResizeObserver(reposition);
        observer.observe(form);
        observer.observe(container);
        return () => observer.disconnect();
    }, [noteForm, editForm]);

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

    const makeOption = useCallback(
        (colors = getResolvedChartColors()) =>
            buildRoastChartOption({
                axisSettings,
                report,
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
                showProfileBt: profileBt,
                showProfileEt: profileEt,
                showProfileRor: profileRor,
                showProfileDrum: profileDrum,
                showProfileHeat: profileHeat,
                showProfileFan: profileFan,
                showTargetDeltaLabel,
                targetXs,
                targetBt,
                targetEt,
                targetRor,
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
                fontScale,
                colors,
            }),
        [
            report,
            axisSettings,
            xs,
            btTarget,
            targetXs,
            targetBt,
            targetEt,
            targetRor,
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
            profileBt,
            profileEt,
            profileRor,
            profileDrum,
            profileHeat,
            profileFan,
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
            tempMinC,
            tempMaxC,
            rorYMin,
            rorYMax,
            xViewMin,
            xViewMax,
            bbpRange,
            hideChargeLabel,
            fontScale,
        ],
    );

    const option = useMemo(() => {
        // CSS chart tokens change with the theme, although the data does not.
        void resolvedTheme;
        void t;
        return makeOption();
    }, [makeOption, resolvedTheme, t]);

    const structureKey = chartStructureKey({
        report,
        charged,
        eventMarkerStyle,
        eventMarkerCount: eventMarkers.length,
        turningPointCount: turningPoints.length,
        showET,
        showTargetCurve,
        showTargetDeltaLabel,
        showRoR,
        showRoRET,
        hasControlData: !!controlData,
        hasHeatSet: !!controlData?.heatSet?.some((value) => value != null),
        showControlDrum,
        showControlHeat,
        showControlFan,
        hasPhaseSegments: phaseSegments.length > 0,
        showFcBand,
        targetXs,
        targetBt,
        targetEt,
        targetRor,
        referenceHeater: controlData?.reference?.heater,
        referenceFan: controlData?.reference?.fan,
        referenceDrum: controlData?.reference?.drum,
        hasBbpRange: !!bbpRange,
        hideChargeLabel,
        fontScale,
    });
    const controlLegend = controlLegendItems(controlData, showControlDrum, showControlHeat, showControlFan);
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
            const xMin = xViewMin ?? xs[0] ?? 0;
            const xMax = xViewMax ?? xs[xs.length - 1] ?? 1200;
            const axisTop = computeTempYRange(tempMinC, tempMaxC, temperatureUnit, yRangeInterval).tempYMax;
            const layoutInputs = [
                ...eventMarkers.flatMap((marker) => {
                    if (hideChargeLabel && marker.event === 'Charge') return [];
                    if (!isEventMarkerVisible(marker.event, marker.timeSec, xMin, xMax, xs, btActual)) return [];
                    const x = scalar(chart.convertToPixel({ xAxisIndex: 0 }, marker.timeSec));
                    const nearest = nearestBtAt(xs, btActual, marker.timeSec);
                    const atTop = noteAnchoredAtTop(marker.event);
                    const displayY = atTop
                        ? axisTop
                        : (nearest ??
                          (marker.tempC != null && Number.isFinite(marker.tempC)
                              ? toDisplayTemp(marker.tempC, temperatureUnit)
                              : axisTop));
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
                            text: eventLabelText(
                                marker.event,
                                marker.timeSec,
                                temp,
                                marker.event === 'Note' ? formatRoastNote(marker) : marker.note,
                            ),
                            below: atTop || LABEL_BELOW_EVENTS.has(marker.event),
                            topInsetPx: noteLabelTopInsetPx(atTop, fontScale),
                            color: '',
                            showDot: eventMarkerStyle === 'point',
                        },
                    ];
                }),
                ...turningPoints.flatMap((tp) => {
                    if (!isCurveMarkerVisible(tp.timeSec, xMin, xMax, xs, btActual)) return [];
                    const x = scalar(chart.convertToPixel({ xAxisIndex: 0 }, tp.timeSec));
                    const displayY = nearestBtAt(xs, btActual, tp.timeSec) ?? toDisplayTemp(tp.temp, temperatureUnit);
                    const y = scalar(chart.convertToPixel({ yAxisIndex: 0 }, displayY));
                    return [
                        {
                            marker: null as RoastEventMarker | null,
                            timeSec: tp.timeSec,
                            xPx: x ?? Number.NaN,
                            yPx: y ?? Number.NaN,
                            text: eventLabelText('TP', tp.timeSec, formatTemp(tp.temp, temperatureUnit)),
                            below: true,
                            color: '',
                            showDot: eventMarkerStyle === 'point',
                        },
                    ];
                }),
            ];
            const boxes = layoutCurveLabelBoxes(layoutInputs, chart.getWidth(), fontScale);
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
            tempMinC,
            yRangeInterval,
            temperatureUnit,
            turningPoints,
            fontScale,
            xs,
            xViewMax,
            xViewMin,
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
            const dragged = eventMarkers.find((marker) => marker.logId === drag.logId);
            const axisMax = xViewMax ?? xs[xs.length - 1] ?? currentTimeSec;
            const nextTimeSec = clampMarkerTime(dragged?.event ?? '', converted, currentTimeSec, axisMax);
            if (nextTimeSec !== drag.timeSec) {
                onEventMarkerDrag(drag.logId, nextTimeSec);
                drag.timeSec = nextTimeSec;
            }
            return true;
        },
        [currentTimeSec, eventMarkers, localPoint, onEventMarkerDrag, xs, xViewMax],
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
            setNoteValues(emptyNote);
            setEditForm({
                logId: selected.logId,
                event: selected.event,
                x: Math.max(0, Math.min(point.x, container.clientWidth - 220)),
                y: Math.max(0, Math.min(point.y, container.clientHeight - 120)),
                time: formatElapsed(selected.timeSec),
                note: selected.event === 'Heater' ? heater.value : (selected.note ?? ''),
                gas: selected.gas ?? '',
                airflow: selected.airflow ?? '',
                heaterUnit: heater.unit,
            });
            return true;
        },
        [findDraggableMarker, localPoint, onEventMarkerEdit],
    );

    const getDataURL = useCallback(
        (size?: { width: number; height: number; pixelRatio?: number }) => {
            const chart = chartInstanceRef.current;
            if (!chart) return null;
            const opts = { type: 'png' as const, pixelRatio: 2, backgroundColor: '#ffffff' };
            if (!size || size.width < 1 || size.height < 1) return chart.getDataURL(opts);

            // Layout in CSS pixels, rasterize at print density so text and strokes scale together.
            const pixelRatio = size.pixelRatio ?? 2;
            const el = document.createElement('div');
            el.style.cssText = `position:absolute;left:-9999px;top:0;width:${size.width / pixelRatio}px;height:${size.height / pixelRatio}px`;
            document.body.appendChild(el);
            const clone = echarts.init(el, undefined, { renderer: 'canvas', devicePixelRatio: pixelRatio });
            try {
                clone.setOption(makeOption(getResolvedChartColors(true)), true);
                return clone.getDataURL({ ...opts, pixelRatio });
            } finally {
                if (clone !== chart) clone.dispose();
                el.remove();
            }
        },
        [makeOption],
    );

    useImperativeHandle(
        ref,
        () => ({ beginMarkerDrag, moveMarkerDrag, endMarkerDrag, hitTestMarker, openMarkerEdit, getDataURL }),
        [beginMarkerDrag, moveMarkerDrag, endMarkerDrag, hitTestMarker, openMarkerEdit, getDataURL],
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
        setNoteValues(emptyNote);
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
            setNoteValues(emptyNote);
            setEditForm(null);
            chartRef.current?.focus();
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [editForm, noteForm]);

    useLayoutEffect(() => {
        const input = timeInputRef.current;
        const caret = timeCaret.current;
        if (!input || caret == null) return;
        timeCaret.current = null;
        const place = () => {
            if (input.isConnected && document.activeElement === input) input.setSelectionRange(caret, caret);
        };
        place();
        requestAnimationFrame(place);
    });

    const markerLogId = editForm?.logId;
    useEffect(() => {
        if (!markerLogId) return;
        const input = timeInputRef.current;
        if (!input) return;
        timeSuppress.current = false;
        timeBypassLogged.current = false;
        let pasteClaimed = false;
        const editTime = (kind: TimeEditKind, text: string) => {
            const start = input.selectionStart ?? 0;
            const end = input.selectionEnd ?? start;
            const res = applyTimeEdit(input.value, start, end, text, kind, timeSuppress.current);
            timeSuppress.current = res.suppress;
            timeCaret.current = res.caret;
            setEditForm((form) => (form ? { ...form, time: res.value } : form));
        };
        const claimPaste = (text: string) => {
            if (pasteClaimed) return;
            pasteClaimed = true;
            queueMicrotask(() => {
                pasteClaimed = false;
            });
            editTime('insert', text);
        };
        const onBefore = (event: Event) => {
            if (!(event instanceof InputEvent)) return;
            const type = event.inputType;
            if (type === 'insertFromPaste') {
                event.preventDefault();
                claimPaste(event.data ?? '');
                return;
            }
            if (type === 'insertText' || type === 'insertReplacementText') {
                event.preventDefault();
                editTime('insert', event.data ?? '');
                return;
            }
            if (type === 'deleteContentBackward') {
                event.preventDefault();
                editTime('backspace', '');
                return;
            }
            if (type === 'deleteContentForward' || type === 'deleteByCut') {
                event.preventDefault();
                editTime('delete', '');
            }
        };
        const onPaste = (event: Event) => {
            if (!(event instanceof ClipboardEvent)) return;
            event.preventDefault();
            claimPaste(event.clipboardData?.getData('text') ?? '');
        };
        input.addEventListener('beforeinput', onBefore);
        input.addEventListener('paste', onPaste);
        return () => {
            input.removeEventListener('beforeinput', onBefore);
            input.removeEventListener('paste', onPaste);
        };
    }, [markerLogId]);

    const handleContextMenu = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (!onAddNote) return;
            const chart = chartInstanceRef.current;
            const point = localPoint(event.clientX, event.clientY);
            const container = chartRef.current;
            if (!chart || !point || !container) return;
            const xMin = xViewMin ?? xs[0] ?? 0;
            const xMax = xViewMax ?? xs[xs.length - 1] ?? currentTimeSec;
            const axisLeft = scalar(chart.convertToPixel({ xAxisIndex: 0 }, xMin));
            const axisRight = scalar(chart.convertToPixel({ xAxisIndex: 0 }, xMax));
            if (axisLeft == null || axisRight == null) return;
            const minX = Math.min(axisLeft, axisRight);
            const maxX = Math.max(axisLeft, axisRight);
            if (point.x < minX - 1 || point.x > maxX + 1) return;
            const converted = scalar(chart.convertFromPixel({ xAxisIndex: 0 }, point.x));
            if (converted == null) return;
            event.preventDefault();
            setNoteValues(emptyNote);
            setEditForm(null);
            setNoteForm({
                x: Math.max(0, Math.min(point.x, container.clientWidth - 220)),
                y: Math.max(0, Math.min(point.y, container.clientHeight - 72)),
                timeSec: clampMarkerTime('Note', converted, currentTimeSec, xMax),
            });
        },
        [currentTimeSec, localPoint, onAddNote, xs, xViewMax, xViewMin],
    );

    const submitNote = useCallback(() => {
        const note = noteValues.note.trim();
        const gas = noteValues.gas.trim();
        const airflow = noteValues.airflow.trim();
        if (!noteForm || (!note && !gas && !airflow) || !onAddNote) return;
        if (gas || airflow)
            onAddNote(note, noteForm.timeSec, { ...(gas ? { gas } : {}), ...(airflow ? { airflow } : {}) });
        else onAddNote(note, noteForm.timeSec);
        setNoteForm(null);
        setNoteValues(emptyNote);
        chartRef.current?.focus();
    }, [noteValues, noteForm, onAddNote]);

    const submitEdit = useCallback(() => {
        if (!editForm || !onEventMarkerEdit) return;
        const timeSec = parseEditTime(editForm.time);
        if (timeSec == null) return;
        const axisMax = xViewMax ?? xs[xs.length - 1] ?? currentTimeSec;
        const patch: EventMarkerPatch = {
            timeSec: clampMarkerTime(editForm.event, timeSec, currentTimeSec, axisMax),
        };
        if (editForm.event === 'Note') {
            const body = editForm.note.trim();
            if (!body && !editForm.gas.trim() && !editForm.airflow.trim()) return;
            patch.note = body;
            patch.gas = editForm.gas.trim();
            patch.airflow = editForm.airflow.trim();
        }
        onEventMarkerEdit(editForm.logId, patch);
        setEditForm(null);
        chartRef.current?.focus();
    }, [currentTimeSec, editForm, onEventMarkerEdit, xs, xViewMax]);

    const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>, submit: () => void) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            setNoteForm(null);
            setEditForm(null);
            setNoteValues(emptyNote);
            chartRef.current?.focus();
        } else if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.nativeEvent.keyCode !== 229
        ) {
            event.preventDefault();
            submit();
        }
    };

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
                    onKeyDown={(event) => handleFormKeyDown(event, submitNote)}
                    className="absolute z-20 flex w-[260px] max-w-full max-h-full flex-col gap-1 overflow-auto rounded border border-(--color-border) bg-(--color-surface) p-1.5 shadow-md"
                    style={{ left: noteForm.x, top: noteForm.y }}
                    onSubmit={(event) => {
                        event.preventDefault();
                        submitNote();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >
                    <div className="flex items-center justify-between px-1 text-[11px] text-(--color-text-primary)">
                        <span className="font-medium">{t('activeRoast.noteEntry.title')}</span>
                        <span className="font-mono text-muted">{formatElapsed(noteForm.timeSec)}</span>
                    </div>
                    <RoastNoteFields
                        values={noteValues}
                        onChange={setNoteValues}
                        prefix="chart-note"
                        commentId="chart-note-input"
                        autoFocus
                    />
                    <div className="flex items-center justify-between gap-1 px-1">
                        <span className="text-[11px] text-muted">{t('activeRoast.noteEntry.keyboardHint')}</span>
                        <button
                            type="submit"
                            disabled={!Object.values(noteValues).some((value) => value.trim())}
                            className="rounded px-2 text-xs text-(--color-text-primary) disabled:opacity-40"
                        >
                            {t('common.add')}
                        </button>
                    </div>
                </form>
            )}
            {editForm && (
                <form
                    ref={editFormRef}
                    data-chart-marker-edit
                    onKeyDown={(event) => handleFormKeyDown(event, submitEdit)}
                    className={`absolute z-20 flex max-w-full max-h-full flex-col gap-1 overflow-auto rounded border border-(--color-border) bg-(--color-surface) p-1.5 shadow-md ${editForm.event === 'Note' ? 'w-[260px]' : 'w-[220px]'}`}
                    style={{ left: editForm.x, top: editForm.y }}
                    onSubmit={(event) => {
                        event.preventDefault();
                        submitEdit();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >
                    <div className="px-1 text-[11px] font-medium text-(--color-text-primary)">
                        {editForm.event === 'Note'
                            ? t('activeRoast.noteEntry.editTitle')
                            : roastEventLabel(editForm.event)}
                    </div>
                    <label className="flex items-center gap-1 px-1 text-[11px] text-muted">
                        {t('activeRoast.noteEntry.time')}
                        <input
                            ref={timeInputRef}
                            id="chart-marker-time"
                            autoFocus
                            inputMode="numeric"
                            autoComplete="off"
                            spellCheck={false}
                            pattern="\d{1,3}:([0-5]?\d|60)"
                            maxLength={6}
                            value={editForm.time}
                            onChange={(event) => {
                                if (event.target.value === editForm.time) return;
                                if (!timeBypassLogged.current) {
                                    timeBypassLogged.current = true;
                                    logger.capture(new Error('Marker time input bypassed beforeinput'));
                                }
                                setEditForm({ ...editForm, time: event.target.value });
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setEditForm(null);
                                    chartRef.current?.focus();
                                    return;
                                }
                                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                                const current = parseEditTime(editForm.time);
                                if (current == null) return;
                                event.preventDefault();
                                const axisMax = xViewMax ?? xs[xs.length - 1] ?? currentTimeSec;
                                const delta = event.key === 'ArrowUp' ? 1 : -1;
                                const next = clampMarkerTime(editForm.event, current + delta, currentTimeSec, axisMax);
                                setEditForm({ ...editForm, time: formatElapsed(next) });
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
                                readOnly
                                disabled
                                className="min-w-0 flex-1 rounded border border-(--color-border) bg-transparent px-2 py-1 font-mono text-xs text-(--color-text-primary) outline-none opacity-60"
                            />
                            <span className="font-mono text-[11px]">{editForm.heaterUnit}</span>
                        </label>
                    )}
                    {editForm.event === 'Note' && (
                        <RoastNoteFields
                            values={editForm}
                            onChange={(values) => setEditForm({ ...editForm, ...values })}
                            prefix="chart-marker"
                            commentId="chart-marker-note"
                        />
                    )}
                    <div className="flex items-center justify-end gap-1">
                        {onEventMarkerDelete && REMOVABLE_LOG_EVENTS.has(editForm.event) && (
                            <button
                                type="button"
                                data-chart-marker-delete
                                onClick={deleteEdit}
                                className="rounded px-2 text-xs text-muted"
                            >
                                {t('common.delete')}
                            </button>
                        )}
                        <button type="submit" className="rounded px-2 text-xs text-(--color-text-primary)">
                            {t('common.save')}
                        </button>
                    </div>
                </form>
            )}
            {controlLegend.length > 0 && (
                <div
                    className="absolute flex items-center gap-4"
                    style={{ bottom: report ? 0 : -15, left: report ? 38 : 25 }}
                >
                    {controlLegend.map((item) => (
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
