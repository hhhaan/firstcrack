import {
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
    isCurveLabelLeaderHit,
    projectCurveLabels,
} from '@features/active-roast/lib/chart-option/curve-label-projection';
import { buildCurveLabels } from '@features/active-roast/lib/chart-option/markers';
import { isRemovableLogEvent } from '@features/active-roast/lib/constants';
import type { CurveLineStyle, ResolvedCurveStyles } from '@features/active-roast/lib/curve-style';
import type { EventMarkerPatch } from '@features/active-roast/lib/event-marker-drag';
import { isFanDrumMarker } from '@features/active-roast/lib/fan-drum-markers';
import { commitManualControl } from '@features/active-roast/lib/manual-controls';
import type { PhaseSegment } from '@features/active-roast/lib/phases';
import { isReviewDeletableEvent, isReviewEditableEvent } from '@features/active-roast/lib/review-record-events';
import { formatRoastNote } from '@features/active-roast/lib/roast-note';
import type { TurningPoint } from '@features/active-roast/lib/turningPoints';
import {
    type EventMarkerStyle,
    getRoastSettings,
    type RoastSettings,
    type TemperatureUnit,
    useRoastSettings,
} from '@features/active-roast/model/settings';
import { useCurveStyles } from '@features/active-roast/model/useCurveStyles';
import { roastEventLabel } from '@shared/i18n/roast-event-label';
import { feedbackLabel, feedbackUnit } from '@shared/lib/feedback';
import { formatElapsed } from '@shared/lib/format';
import { commitEditTime, isPartialTime, parseEditTime } from '@shared/lib/time-edit';
import { useThemeStore } from '@shared/store/theme';
import type { RoastNoteControls } from '@shared/types/roast';
import * as echarts from 'echarts';
import { Check } from 'lucide-react';
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
import { CurveSwatch } from './CurveSwatch';
import { RoastNoteFields, type RoastNoteValues } from './RoastNoteFields';

export type { RoastEventMarker };

const emptyNote: RoastNoteValues = { gas: '', airflow: '', drum: '', note: '' };

type ChartAxisInput = Pick<
    RoastSettings,
    | 'tempLabelInterval'
    | 'tempTickMode'
    | 'tempTicksC'
    | 'timeTickPresetSec'
    | 'timeTickIntervalSec'
    | 'timeMinorTickIntervalSec'
    | 'timeTickCustom'
    | 'horizontalGridInterval'
    | 'horizontalGridPresetInterval'
    | 'horizontalGridMode'
    | 'rorTickMode'
    | 'rorTicksC'
    | 'rorLabelInterval'
>;

const chartAxisSettings = (settings: ChartAxisInput) => ({
    horizontalGridInterval:
        settings.horizontalGridMode === 'preset'
            ? settings.horizontalGridPresetInterval
            : settings.horizontalGridInterval,
    rorLabelInterval: settings.rorLabelInterval,
    rorTicksC: settings.rorTickMode === 'list' ? settings.rorTicksC : [],
    tempLabelInterval: settings.tempLabelInterval,
    tempTicksC: settings.tempTickMode === 'list' ? settings.tempTicksC : [],
    timeTickIntervalSec: settings.timeTickCustom ? settings.timeTickIntervalSec : settings.timeTickPresetSec,
    timeMinorTickIntervalSec: settings.timeMinorTickIntervalSec,
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
    /** Saved curve. Drag stays put. Right-click labels and the roast log edit the record. */
    savedReview?: boolean;
    onAddNote?: (body: string, timeSec: number, controls?: RoastNoteControls) => void;
    onAddEvent?: (event: string, timeSec: number) => void;
    /** Saved curve: a right-click label that already exists moves to the clicked time. */
    onMoveEvent?: (event: string, timeSec: number) => void;
    showET?: boolean;
    showTargetCurve?: boolean;
    showProfileBt?: boolean;
    showProfileEt?: boolean;
    showProfileRor?: boolean;
    showProfileEtRor?: boolean;
    showProfileDrum?: boolean;
    showProfileHeat?: boolean;
    showProfileFan?: boolean;
    showTargetDeltaLabel?: boolean;
    targetXs?: number[];
    targetBt?: (number | null)[];
    targetEt?: (number | null)[];
    targetRor?: (number | null)[];
    targetEtRor?: (number | null)[];
    showRoR?: boolean;
    showRoRET?: boolean;
    rorEtActual?: (number | null)[];
    controlData?: ControlData;
    showControlDrum?: boolean;
    showControlHeat?: boolean;
    showControlFan?: boolean;
    controlChartHeightPct?: number;
    mergeControlChart?: boolean;
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
    const cap = event === 'Note' || event === 'Fan' || event === 'Drum' ? axisMaxSec : Math.floor(nowSec);
    return Math.max(0, Math.min(cap, Math.round(timeSec)));
};

/** Chart label value: heater `90%` / `65kPa`, or a fan/drum number. The unit stays put. */
const labelHeat = (event: string, note?: string): { heat: string; suffix: string } | null => {
    if (event !== 'Heater' && !isFanDrumMarker(event)) return null;
    const match = /^(\d+(?:\.\d+)?)(.*)$/.exec(note?.trim() ?? '');
    return match ? { heat: match[1], suffix: match[2] } : { heat: '', suffix: '' };
};

const HEAT_DRAFT = /^\d*(\.\d{0,2})?$/;

const heatNote = (heat: string, suffix: string): string | null => {
    const normalized = heat.trim().replace(/\.$/, '');
    return /^\d+(\.\d+)?$/.test(normalized) ? `${normalized}${suffix}` : null;
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
    mergeControlChart: boolean;
    hasControlData: boolean;
    hasHeatSet: boolean;
    showControlDrum: boolean;
    showControlHeat: boolean;
    showControlFan: boolean;
    showProfileBt: boolean;
    showProfileEt: boolean;
    showProfileRor: boolean;
    showProfileEtRor: boolean;
    showProfileDrum: boolean;
    showProfileHeat: boolean;
    showProfileFan: boolean;
    hasPhaseSegments: boolean;
    showFcBand: boolean;
    targetXs: number[] | undefined;
    targetBt: (number | null)[] | undefined;
    targetEt: (number | null)[] | undefined;
    targetRor: (number | null)[] | undefined;
    targetEtRor: (number | null)[] | undefined;
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
        input.mergeControlChart,
        input.hasControlData,
        input.hasHeatSet,
        input.showControlDrum,
        input.showControlHeat,
        input.showControlFan,
        input.showProfileBt,
        input.showProfileEt,
        input.showProfileRor,
        input.showProfileEtRor,
        input.showProfileDrum,
        input.showProfileHeat,
        input.showProfileFan,
        input.hasPhaseSegments,
        input.showFcBand,
        !!(input.targetXs?.length && input.targetBt?.length),
        seriesPresent(input.targetEt),
        seriesPresent(input.targetRor),
        seriesPresent(input.targetEtRor),
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
    curves: ResolvedCurveStyles,
): { style: CurveLineStyle; label: string }[] => {
    if (!controlData || (!drum && !heat && !fan)) return [];
    const units = controlData.readUnits?.[controlData.readUnits.length - 1];
    const label = (role: 'heater' | 'fan' | 'drum') =>
        units?.[role] ? `${feedbackLabel(role, units)} (${feedbackUnit(role, units)})` : feedbackLabel(role);
    return [
        ...(drum ? [{ style: curves.drum.current, label: label('drum') }] : []),
        ...(heat ? [{ style: curves.heat.current, label: label('heater') }] : []),
        ...(fan ? [{ style: curves.fan.current, label: label('fan') }] : []),
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
        eventMarkerStyle = 'line',
        eventMarkers,
        turningPoints = [],
        temperatureUnit = 'C',
        height,
        onCursorIdx,
        onEventMarkerDrag,
        onEventMarkerEdit,
        onEventMarkerDelete,
        savedReview = false,
        onAddNote,
        onAddEvent,
        onMoveEvent,
        hideChargeLabel = false,
        showET = true,
        showTargetCurve = true,
        showProfileBt,
        showProfileEt,
        showProfileRor,
        showProfileEtRor,
        showProfileDrum,
        showProfileHeat,
        showProfileFan,
        showTargetDeltaLabel = false,
        targetXs,
        targetBt,
        targetEt,
        targetRor,
        targetEtRor,
        showRoR = true,
        showRoRET = false,
        rorEtActual = [],
        controlData,
        showControlDrum = true,
        showControlHeat = true,
        showControlFan = true,
        controlChartHeightPct = 21,
        mergeControlChart = false,
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
    const profileEtRor = profileShown(showProfileEtRor);
    const profileDrum = profileShown(showProfileDrum);
    const profileHeat = profileShown(showProfileHeat);
    const profileFan = profileShown(showProfileFan);
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstanceRef = useRef<echarts.ECharts | null>(null);
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
    const roastSettings = useRoastSettings();
    const { curveStyles } = roastSettings;
    const curves = useCurveStyles();
    const fontScale = roastSettings.fontScalePct / 100;
    const axisSettings = useMemo(() => chartAxisSettings(roastSettings), [roastSettings]);

    const dragStateRef = useRef<{
        pointerId: number;
        logId: string;
        event: string;
        timeSec: number;
        originTimeSec: number;
        originX: number;
    } | null>(null);
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
        title: string;
        heat: string | null;
        heatSuffix: string;
        controls: RoastNoteValues | null;
    } | null>(null);
    const editFormRef = useRef<HTMLFormElement>(null);

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
        (colors = getResolvedChartColors(), print = false) =>
            buildRoastChartOption({
                axisSettings,
                report,
                print,
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
                showProfileEtRor: profileEtRor,
                showProfileDrum: profileDrum,
                showProfileHeat: profileHeat,
                showProfileFan: profileFan,
                showTargetDeltaLabel,
                targetXs,
                targetBt,
                targetEt,
                targetRor,
                targetEtRor,
                showRoR,
                showRoRET,
                rorEtActual,
                controlData,
                showControlDrum,
                showControlHeat,
                showControlFan,
                controlChartHeightPct,
                mergeControlChart,
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
                curveStyles,
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
            targetEtRor,
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
            profileEtRor,
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
            mergeControlChart,
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
            curveStyles,
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
        mergeControlChart,
        hasControlData: !!controlData,
        hasHeatSet: !!controlData?.heatSet?.some((value) => value != null),
        showControlDrum,
        showControlHeat,
        showControlFan,
        showProfileBt: profileBt,
        showProfileEt: profileEt,
        showProfileRor: profileRor,
        showProfileEtRor: profileEtRor,
        showProfileDrum: profileDrum,
        showProfileHeat: profileHeat,
        showProfileFan: profileFan,
        hasPhaseSegments: phaseSegments.length > 0,
        showFcBand,
        targetXs,
        targetBt,
        targetEt,
        targetRor,
        targetEtRor,
        referenceHeater: controlData?.reference?.heater,
        referenceFan: controlData?.reference?.fan,
        referenceDrum: controlData?.reference?.drum,
        hasBbpRange: !!bbpRange,
        hideChargeLabel,
        fontScale,
    });
    const controlLegend = controlLegendItems(controlData, showControlDrum, showControlHeat, showControlFan, curves);
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
            if (point.x < 0 || point.y < 0 || point.x > chart.getWidth() || point.y > chart.getHeight()) return null;
            const xMin = xViewMin ?? xs[0] ?? 0;
            const xMax = xViewMax ?? xs[xs.length - 1] ?? 1200;
            const { tempYMin, tempYMax } = computeTempYRange(tempMinC, tempMaxC, temperatureUnit);
            const items = buildCurveLabels({
                eventMarkerStyle,
                eventMarkers,
                turningPoints,
                temperatureUnit,
                unitLabel: `°${temperatureUnit}`,
                xs,
                btActual,
                xMin,
                xMax,
                tempYMax,
                hideChargeLabel,
                fontScale,
            });
            const coord = ([time, temp]: number[]) => [
                scalar(chart.convertToPixel({ xAxisIndex: 0 }, time)) ?? Number.NaN,
                scalar(chart.convertToPixel({ yAxisIndex: 0 }, temp)) ?? Number.NaN,
            ];
            const [left, top] = coord([xMin, tempYMax]);
            const [right, bottom] = coord([xMax, tempYMin]);
            const boxes = projectCurveLabels(
                items,
                coord,
                { x: left, y: top, width: right - left, height: bottom - top },
                fontScale,
            );
            const byItem = new Map(boxes.map((box) => [box.item, box]));
            const candidates = items.flatMap((item, index) => {
                const marker = item.marker;
                if (!marker) return [];
                if (marker.reference || marker.readOnly) return [];
                if (
                    !marker?.logId ||
                    marker.event === 'Charge' ||
                    (savedReview && !isReviewEditableEvent(marker.event))
                )
                    return [];
                const [x, anchorY] = coord([item.timeSec, item.y]);
                if (!Number.isFinite(x)) return [];
                const box = byItem.get(item);
                const labelHit = Boolean(
                    box &&
                        box.bottom > box.top &&
                        point.x >= box.left - 4 &&
                        point.x <= box.right + 4 &&
                        point.y >= box.top - 4 &&
                        point.y <= box.bottom + 4,
                );
                const plotHit = chart.containPixel({ gridIndex: [0, 1, 2] }, [point.x, point.y]);
                const pointHit =
                    eventMarkerStyle === 'point' &&
                    item.showDot &&
                    anchorY >= top &&
                    anchorY <= bottom &&
                    plotHit &&
                    Number.isFinite(anchorY) &&
                    Math.hypot(point.x - x, point.y - anchorY) <= PIXEL_THRESHOLD;
                const lineHit =
                    (eventMarkerStyle === 'line' || eventMarkerStyle === 'tempLine') &&
                    plotHit &&
                    Math.abs(point.x - x) <= PIXEL_THRESHOLD;
                const labelY = box?.textY ?? anchorY;
                const leaderHit = box && plotHit && isCurveLabelLeaderHit(box, point.x, point.y, PIXEL_THRESHOLD);
                return labelHit || pointHit || lineHit || leaderHit
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
            temperatureUnit,
            turningPoints,
            savedReview,
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
            const point = localPoint(event.clientX, event.clientY);
            if (!selected?.logId || !point) return false;
            // Label text sits to the right of the event. Absolute pointer time would jump there,
            // and past the live head that clamps to the latest sample.
            dragStateRef.current = {
                pointerId: event.pointerId,
                logId: selected.logId,
                event: selected.event,
                timeSec: selected.timeSec,
                originTimeSec: selected.timeSec,
                originX: point.x,
            };
            return true;
        },
        [findDraggableMarker, localPoint],
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
            if (savedReview) return true;
            const chart = chartInstanceRef.current;
            const point = localPoint(event.clientX, event.clientY);
            if (!chart || !point) return true;
            const origin = scalar(chart.convertFromPixel({ xAxisIndex: 0 }, drag.originX));
            const converted = scalar(chart.convertFromPixel({ xAxisIndex: 0 }, point.x));
            if (origin == null || converted == null) return true;
            const axisMax = xViewMax ?? xs[xs.length - 1] ?? currentTimeSec;
            const nextTimeSec = clampMarkerTime(
                drag.event,
                drag.originTimeSec + (converted - origin),
                currentTimeSec,
                axisMax,
            );
            if (nextTimeSec !== drag.timeSec) {
                onEventMarkerDrag(drag.logId, nextTimeSec);
                drag.timeSec = nextTimeSec;
            }
            return true;
        },
        [currentTimeSec, localPoint, onEventMarkerDrag, savedReview, xs, xViewMax],
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
            const noteTitle = formatRoastNote(selected).trim();
            const title = isFanDrumMarker(selected.event)
                ? t(selected.event === 'Fan' ? 'activeRoast.controls.fan' : 'activeRoast.controls.drum')
                : selected.event === 'Note' && noteTitle
                  ? noteTitle
                  : roastEventLabel(selected.event);
            const heat = labelHeat(selected.event, selected.note);
            const manual = getRoastSettings().manualControls;
            const controls =
                selected.event === 'Note'
                    ? {
                          gas: commitManualControl('gas', selected.gas ?? '', manual),
                          airflow: commitManualControl('airflow', selected.airflow ?? '', manual),
                          drum: commitManualControl('drum', selected.drum ?? '', manual),
                          note: selected.note ?? '',
                      }
                    : null;
            const editWidth = controls ? 260 : 220;
            setNoteForm(null);
            setNoteValues(emptyNote);
            setEditForm({
                logId: selected.logId,
                event: selected.event,
                x: Math.max(0, Math.min(point.x, container.clientWidth - editWidth)),
                y: Math.max(0, Math.min(point.y, container.clientHeight - (controls ? 220 : 120))),
                time: formatElapsed(selected.timeSec),
                title,
                heat: heat?.heat ?? null,
                heatSuffix: heat?.suffix ?? '',
                controls,
            });
            return true;
        },
        [findDraggableMarker, localPoint, onEventMarkerEdit, t],
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
                clone.setOption(makeOption(getResolvedChartColors(true), true), true);
                return clone.getDataURL({ ...opts, backgroundColor: 'rgba(0,0,0,0)', pixelRatio });
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
            if (converted == null || (charged && converted < 0)) return;
            event.preventDefault();
            setNoteValues(emptyNote);
            setEditForm(null);
            setNoteForm({
                x: Math.max(0, Math.min(point.x, container.clientWidth - 220)),
                y: Math.max(0, Math.min(point.y, container.clientHeight - 72)),
                timeSec: clampMarkerTime('Note', converted, currentTimeSec, xMax),
            });
        },
        [currentTimeSec, localPoint, onAddNote, xs, xViewMax, xViewMin, charged],
    );

    const submitNote = useCallback(() => {
        const manual = getRoastSettings().manualControls;
        const note = noteValues.note.trim();
        const gas = commitManualControl('gas', noteValues.gas, manual);
        const airflow = commitManualControl('airflow', noteValues.airflow, manual);
        const drum = commitManualControl('drum', noteValues.drum, manual);
        if (!noteForm || (!note && !gas && !airflow && !drum) || !onAddNote) return;
        if (gas || airflow || drum)
            onAddNote(note, noteForm.timeSec, {
                ...(gas ? { gas } : {}),
                ...(airflow ? { airflow } : {}),
                ...(drum ? { drum } : {}),
            });
        else onAddNote(note, noteForm.timeSec);
        setNoteForm(null);
        setNoteValues(emptyNote);
        chartRef.current?.focus();
    }, [noteValues, noteForm, onAddNote]);

    const submitEdit = useCallback(() => {
        if (!editForm || !onEventMarkerEdit) return;
        const timeSec = parseEditTime(commitEditTime(editForm.time));
        if (timeSec == null) return;
        const axisMax = xViewMax ?? xs[xs.length - 1] ?? currentTimeSec;
        const note = editForm.heat == null ? null : heatNote(editForm.heat, editForm.heatSuffix);
        if (editForm.heat != null && note == null) return;
        const controls = editForm.controls;
        const manual = getRoastSettings().manualControls;
        onEventMarkerEdit(editForm.logId, {
            timeSec: clampMarkerTime(editForm.event, timeSec, currentTimeSec, axisMax),
            ...(note != null ? { note } : {}),
            ...(controls
                ? {
                      note: controls.note,
                      gas: commitManualControl('gas', controls.gas, manual),
                      airflow: commitManualControl('airflow', controls.airflow, manual),
                      drum: commitManualControl('drum', controls.drum, manual),
                  }
                : {}),
        });
        setEditForm(null);
        chartRef.current?.focus();
    }, [currentTimeSec, editForm, onEventMarkerEdit, xs, xViewMax]);

    const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>, submit: () => void) => {
        if (event.key === 'Enter' && event.target instanceof HTMLButtonElement && event.target.type === 'button')
            return;
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

    const canDeleteMarker = useCallback(
        (event: string) =>
            isFanDrumMarker(event) || (savedReview ? isReviewDeletableEvent(event) : isRemovableLogEvent(event)),
        [savedReview],
    );

    const deleteEdit = useCallback(() => {
        if (!editForm || !onEventMarkerDelete || !canDeleteMarker(editForm.event)) return;
        onEventMarkerDelete(editForm.logId);
        setEditForm(null);
        chartRef.current?.focus();
    }, [editForm, onEventMarkerDelete, canDeleteMarker]);

    return (
        <div
            data-app-context-menu
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
                    {onAddEvent && (
                        <div
                            className="flex items-center gap-1 px-1"
                            role="group"
                            aria-label={t('activeRoast.noteEntry.events')}
                        >
                            <span className="w-[52px] shrink-0 text-[11px] text-muted">
                                {t('activeRoast.noteEntry.events')}
                            </span>
                            {[
                                ['CC', 'Yellow'],
                                ['FC', 'FC Start'],
                                ['SC', 'FC End'],
                            ].map(([label, event]) => {
                                const recorded = eventMarkers.some((marker) => marker.event === event);
                                const description = recorded
                                    ? t('activeRoast.noteEntry.eventRecorded', { event: roastEventLabel(event) })
                                    : roastEventLabel(event);
                                return (
                                    <button
                                        key={event}
                                        type="button"
                                        data-chart-note-event={event}
                                        aria-label={description}
                                        title={description}
                                        aria-describedby={
                                            noteForm.timeSec > currentTimeSec ? 'chart-note-future-hint' : undefined
                                        }
                                        disabled={noteForm.timeSec > currentTimeSec}
                                        onClick={() => {
                                            if (recorded && onMoveEvent) onMoveEvent(event, noteForm.timeSec);
                                            else if (!recorded) onAddEvent(event, noteForm.timeSec);
                                            setNoteForm(null);
                                            setNoteValues(emptyNote);
                                            chartRef.current?.focus();
                                        }}
                                        className={`flex h-7 cursor-pointer items-center justify-center gap-1 rounded border px-2 text-[11px] font-semibold disabled:cursor-default ${recorded ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-surface text-secondary hover:bg-main-bg disabled:opacity-40'}`}
                                    >
                                        {recorded && <Check className="size-3" aria-hidden="true" />}
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {onAddEvent && noteForm.timeSec > currentTimeSec && (
                        <p id="chart-note-future-hint" className="m-0 px-1 text-[10px] text-muted">
                            {t('activeRoast.noteEntry.futureEventHint')}
                        </p>
                    )}
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
                            className="shrink-0 cursor-pointer rounded bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-default disabled:opacity-40"
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
                    className={`absolute z-20 flex ${editForm.controls ? 'w-[260px]' : 'w-[220px]'} max-w-full max-h-full flex-col gap-1 overflow-auto rounded border border-(--color-border) bg-(--color-surface) p-1.5 shadow-md`}
                    style={{ left: editForm.x, top: editForm.y }}
                    onSubmit={(event) => {
                        event.preventDefault();
                        submitEdit();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >
                    <div className="px-1 text-[11px] font-medium text-(--color-text-primary)">{editForm.title}</div>
                    <label className="flex items-center gap-1 px-1 text-[11px] text-muted">
                        {t('activeRoast.noteEntry.time')}
                        <input
                            id="chart-marker-time"
                            autoFocus
                            inputMode="numeric"
                            autoComplete="off"
                            spellCheck={false}
                            value={editForm.time}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) => {
                                const next = event.target.value;
                                if (next !== '' && !isPartialTime(next)) {
                                    event.target.value = editForm.time;
                                    return;
                                }
                                setEditForm({ ...editForm, time: next });
                            }}
                            onBlur={() => {
                                setEditForm((form) => {
                                    if (!form) return form;
                                    const committed = commitEditTime(form.time);
                                    return committed === form.time ? form : { ...form, time: committed };
                                });
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
                    {editForm.heat != null && (
                        <label className="flex items-center gap-1 px-1 text-[11px] text-muted">
                            {editForm.event === 'Heater'
                                ? t('heaterEventsEditor.heat')
                                : t(
                                      editForm.event === 'Fan'
                                          ? 'activeRoast.controls.fan'
                                          : 'activeRoast.controls.drum',
                                  )}
                            <input
                                id="chart-marker-heat"
                                inputMode="decimal"
                                autoComplete="off"
                                spellCheck={false}
                                value={editForm.heat}
                                onFocus={(event) => event.currentTarget.select()}
                                onChange={(event) => {
                                    const next = event.target.value;
                                    if (!HEAT_DRAFT.test(next)) {
                                        event.target.value = editForm.heat ?? '';
                                        return;
                                    }
                                    setEditForm({ ...editForm, heat: next });
                                }}
                                className="min-w-0 flex-1 rounded border border-(--color-border) bg-transparent px-2 py-1 font-mono text-xs text-(--color-text-primary) outline-none"
                            />
                            {editForm.heatSuffix && (
                                <span className="font-mono text-xs text-(--color-text-primary)">
                                    {editForm.heatSuffix}
                                </span>
                            )}
                        </label>
                    )}
                    {editForm.controls && (
                        <RoastNoteFields
                            values={editForm.controls}
                            onChange={(controls) => setEditForm({ ...editForm, controls })}
                            prefix="chart-marker"
                            commentId="chart-marker-note"
                        />
                    )}
                    <div className="flex items-center justify-end gap-1">
                        {onEventMarkerDelete &&
                            (canDeleteMarker(editForm.event) || (savedReview && editForm.event === 'TP')) && (
                                <button
                                    type="button"
                                    data-chart-marker-delete
                                    disabled={savedReview && editForm.event === 'TP'}
                                    onClick={deleteEdit}
                                    className="rounded px-2 text-xs text-muted disabled:cursor-default disabled:opacity-40"
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
                            <CurveSwatch style={item.style} />
                            <span className="text-[11px] text-muted tracking-[0.14px]">{item.label}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});
