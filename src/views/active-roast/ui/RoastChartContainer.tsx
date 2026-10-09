import type { ControlData, RoastEventMarker } from '@features/active-roast/lib/chart-option';
import type { EventMarkerPatch } from '@features/active-roast/lib/event-marker-drag';
import type { PhaseSegment } from '@features/active-roast/lib/phases';
import type { EventMarkerStyle, TemperatureUnit } from '@features/active-roast/model/settings';
import { ChartZoomSurface } from '@features/active-roast/ui/ChartZoomSurface';
import { RoastTempChart, type RoastTempChartHandle } from '@features/active-roast/ui/RoastTempChart';
import type { RoastNoteControls } from '@shared/types/roast';
import { type RefObject, useRef, useState } from 'react';
import { ChartLegend } from './ChartLegend';

const applyMarkerPointer = (surface: HTMLElement, on: boolean) => {
    const cursor = on ? 'pointer' : '';
    surface.style.cursor = cursor;
    for (const canvas of surface.querySelectorAll('canvas')) {
        canvas.style.cursor = cursor;
    }
};

interface RoastChartContainerProps {
    chartAreaRef: RefObject<HTMLDivElement | null>;
    mainChartHeight: number;
    effectiveZoomRange: { start: number; end: number } | null;
    isChartDragging: boolean;
    handleChartPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    handleChartPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    endChartDrag: (event: React.PointerEvent<HTMLDivElement>) => void;
    xs: number[];
    btActual: (number | null)[];
    etActual: (number | null)[];
    rorActual: (number | null)[];
    rorEtActual: (number | null)[];
    targetXs: number[];
    targetBt: number[];
    targetEt?: (number | null)[];
    targetRor?: (number | null)[];
    targetEtRor?: (number | null)[];
    showTargetCurve: boolean;
    showProfileBt?: boolean;
    showProfileEt?: boolean;
    showProfileRor?: boolean;
    showProfileEtRor?: boolean;
    showProfileDrum?: boolean;
    showProfileHeat?: boolean;
    showProfileFan?: boolean;
    showTargetDeltaLabel?: boolean;
    showET: boolean;
    showRoR: boolean;
    showRoRET: boolean;
    controlData?: ControlData;
    showControlDrum?: boolean;
    showControlHeat?: boolean;
    showControlFan?: boolean;
    controlChartHeightPct?: number;
    controlYMin?: number;
    controlYMax?: number;
    tempMinC: number;
    tempMaxC: number;
    rorYMin: number;
    rorYMax: number;
    elapsed: number;
    charged: boolean;
    eventMarkerStyle: EventMarkerStyle;
    eventMarkers: RoastEventMarker[];
    turningPoints: { timeSec: number; temp: number }[];
    phaseSegments: PhaseSegment[];
    showFcBand?: boolean;
    unit: TemperatureUnit;
    targetProfileName?: string;
    bbpRange?: { start: number; end: number; label?: string };
    onCursorIdx: (idx: number | null) => void;
    onEventMarkerDrag?: (logId: string, newTimeSec: number) => void;
    onEventMarkerEdit?: (logId: string, patch: EventMarkerPatch) => void;
    onEventMarkerDelete?: (logId: string) => void;
    onAddNote?: (body: string, timeSec: number, controls?: RoastNoteControls) => void;
    onAddEvent?: (event: string, timeSec: number) => void;
}

export const RoastChartContainer = ({
    chartAreaRef,
    mainChartHeight,
    effectiveZoomRange,
    isChartDragging,
    handleChartPointerDown,
    handleChartPointerMove,
    endChartDrag,
    xs,
    btActual,
    etActual,
    rorActual,
    rorEtActual,
    targetXs,
    targetBt,
    targetEt,
    targetRor,
    targetEtRor,
    showTargetCurve,
    showProfileBt = true,
    showProfileEt = true,
    showProfileRor = true,
    showProfileEtRor = true,
    showProfileDrum = true,
    showProfileHeat = true,
    showProfileFan = true,
    showTargetDeltaLabel = false,
    showET,
    showRoR,
    showRoRET,
    controlData,
    showControlDrum = true,
    showControlHeat = true,
    showControlFan = true,
    controlChartHeightPct = 21,
    controlYMin = 0,
    controlYMax = 100,
    tempMinC,
    tempMaxC,
    rorYMin,
    rorYMax,
    elapsed,
    charged,
    eventMarkerStyle,
    eventMarkers,
    turningPoints,
    phaseSegments,
    showFcBand = true,
    unit,
    targetProfileName,
    bbpRange,
    onCursorIdx,
    onEventMarkerDrag,
    onEventMarkerEdit,
    onEventMarkerDelete,
    onAddNote,
    onAddEvent,
}: RoastChartContainerProps) => {
    const chartRef = useRef<RoastTempChartHandle>(null);
    const markerPointerId = useRef<number | null>(null);
    const markerDragStart = useRef<{ x: number; y: number } | null>(null);
    const markerMoved = useRef(false);
    const markerCursorRef = useRef(false);
    const [markerCursor, setMarkerCursor] = useState(false);

    const setMarkerPointer = (surface: HTMLElement, on: boolean) => {
        const changed = markerCursorRef.current !== on;
        markerCursorRef.current = on;
        if (changed) setMarkerCursor(on);
        if (on) {
            applyMarkerPointer(surface, true);
            requestAnimationFrame(() => {
                if (markerCursorRef.current) applyMarkerPointer(surface, true);
            });
        } else if (changed) {
            applyMarkerPointer(surface, false);
        }
    };

    const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if ((event.target as Element).closest('[data-chart-note-form],[data-chart-marker-edit]')) return;
        if (chartRef.current?.beginMarkerDrag(event)) {
            markerPointerId.current = event.pointerId;
            markerDragStart.current = { x: event.clientX, y: event.clientY };
            markerMoved.current = false;
            setMarkerPointer(event.currentTarget, true);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus();
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        handleChartPointerDown(event);
    };

    const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (markerPointerId.current === event.pointerId) {
            if (!markerMoved.current && markerDragStart.current) {
                const dx = event.clientX - markerDragStart.current.x;
                const dy = event.clientY - markerDragStart.current.y;
                if (Math.hypot(dx, dy) < 5) {
                    event.preventDefault();
                    return;
                }
                markerMoved.current = true;
            }
            if (chartRef.current?.moveMarkerDrag(event)) {
                setMarkerPointer(event.currentTarget, true);
                event.preventDefault();
                return;
            }
        }
        if (!isChartDragging) {
            setMarkerPointer(
                event.currentTarget,
                Boolean((onEventMarkerDrag || onEventMarkerEdit) && chartRef.current?.hitTestMarker(event)),
            );
        }
        handleChartPointerMove(event);
    };

    const pointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
        if (markerPointerId.current === event.pointerId) {
            const wasClick = !markerMoved.current && event.type === 'pointerup';
            chartRef.current?.endMarkerDrag(event.pointerId);
            markerPointerId.current = null;
            markerDragStart.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
            if (wasClick) chartRef.current?.openMarkerEdit(event);
            setMarkerPointer(
                event.currentTarget,
                Boolean((onEventMarkerDrag || onEventMarkerEdit) && chartRef.current?.hitTestMarker(event)),
            );
            return;
        }
        endChartDrag(event);
    };

    return (
        <ChartZoomSurface
            chartAreaRef={chartAreaRef}
            effectiveZoomRange={effectiveZoomRange}
            isChartDragging={isChartDragging}
            handleChartPointerDown={pointerDown}
            handleChartPointerMove={pointerMove}
            endChartDrag={pointerEnd}
            className="relative flex-1 flex flex-col min-w-0 min-h-0 outline-none"
            idleCursorClassName="cursor-default"
            cursorOverrideClassName={markerCursor ? 'cursor-pointer' : undefined}
            onPointerLeave={() => {
                if (markerPointerId.current == null && chartAreaRef.current) {
                    setMarkerPointer(chartAreaRef.current, false);
                }
            }}
            ariaLabel="Temperature curve chart. Use wheel or plus and minus to zoom, drag or use left and right arrows to pan, and 0 to reset zoom."
        >
            <ChartLegend
                showTarget={showTargetCurve && showProfileBt}
                targetLabel={targetProfileName}
                showET={showET}
                showRoR={showRoR}
                showRoRET={showRoRET}
            />

            <RoastTempChart
                ref={chartRef}
                xs={xs}
                btTarget={[]}
                targetXs={targetXs}
                targetBt={targetBt}
                targetEt={targetEt}
                targetRor={targetRor}
                targetEtRor={targetEtRor}
                btActual={btActual}
                etActual={etActual}
                rorActual={rorActual}
                currentTimeSec={elapsed}
                charged={charged}
                eventMarkerStyle={eventMarkerStyle}
                eventMarkers={eventMarkers}
                hideChargeLabel
                turningPoints={turningPoints}
                height={mainChartHeight}
                onCursorIdx={onCursorIdx}
                onEventMarkerDrag={onEventMarkerDrag}
                onEventMarkerEdit={onEventMarkerEdit}
                onEventMarkerDelete={onEventMarkerDelete}
                onAddNote={onAddNote}
                onAddEvent={onAddEvent}
                showET={showET}
                showTargetCurve={showTargetCurve}
                showProfileBt={showProfileBt}
                showProfileEt={showProfileEt}
                showProfileRor={showProfileRor}
                showProfileEtRor={showProfileEtRor}
                showProfileDrum={showProfileDrum}
                showProfileHeat={showProfileHeat}
                showProfileFan={showProfileFan}
                showTargetDeltaLabel={showTargetDeltaLabel}
                showRoR={showRoR}
                showRoRET={showRoRET}
                rorEtActual={rorEtActual}
                temperatureUnit={unit}
                xViewMin={effectiveZoomRange?.start}
                xViewMax={effectiveZoomRange?.end}
                bbpRange={bbpRange}
                controlData={controlData}
                showControlDrum={showControlDrum}
                showControlHeat={showControlHeat}
                showControlFan={showControlFan}
                controlChartHeightPct={controlChartHeightPct}
                controlYMin={controlYMin}
                controlYMax={controlYMax}
                phaseSegments={phaseSegments}
                showFcBand={showFcBand}
                tempMinC={tempMinC}
                tempMaxC={tempMaxC}
                rorYMin={rorYMin}
                rorYMax={rorYMax}
            />
        </ChartZoomSurface>
    );
};
