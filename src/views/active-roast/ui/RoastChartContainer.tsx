import type { PhaseSegment } from '@features/active-roast/lib/phases';
import type { EventMarkerStyle, TemperatureUnit } from '@features/active-roast/model/settings';
import type { RefObject } from 'react';
import { ChartLegend } from './ChartLegend';
import type { RoastEventMarker } from './RoastTempChart';
import { RoastTempChart } from './RoastTempChart';

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
    showTargetCurve: boolean;
    showET: boolean;
    showRoR: boolean;
    showRoRET: boolean;
    controlData?: {
        xs: number[];
        drumTemp: (number | null)[];
        heatPower: (number | null)[];
        fanSpeed: (number | null)[];
    };
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
    unit: TemperatureUnit;
    targetProfileName?: string;
    onCursorIdx: (idx: number | null) => void;
    onEventMarkerDrag: (event: string, newTimeSec: number) => void;
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
    showTargetCurve,
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
    unit,
    targetProfileName,
    onCursorIdx,
    onEventMarkerDrag,
}: RoastChartContainerProps) => {
    return (
        <div
            ref={chartAreaRef}
            className={`relative flex-1 flex flex-col min-w-0 min-h-0 outline-none ${
                effectiveZoomRange
                    ? isChartDragging
                        ? 'cursor-grabbing select-none touch-none'
                        : 'cursor-grab touch-none'
                    : 'cursor-default'
            }`}
            // wheel: native listener on chartAreaRef (useChartZoom) — ECharts steals bubble wheel
            // pointer capture: ECharts canvas stops bubble
            onPointerDownCapture={handleChartPointerDown}
            onPointerMoveCapture={handleChartPointerMove}
            onPointerUpCapture={endChartDrag}
            onPointerCancelCapture={endChartDrag}
            role="region"
            aria-label="Temperature curve chart. Use wheel or plus and minus to zoom, drag or use left and right arrows to pan, and 0 to reset zoom."
        >
            <ChartLegend
                showTarget={showTargetCurve}
                targetLabel={targetProfileName}
                showET={showET}
                showRoR={showRoR}
                showRoRET={showRoRET}
            />

            <RoastTempChart
                xs={xs}
                btTarget={[]}
                targetXs={targetXs}
                targetBt={targetBt}
                btActual={btActual}
                etActual={etActual}
                rorActual={rorActual}
                currentTimeSec={elapsed}
                charged={charged}
                eventMarkerStyle={eventMarkerStyle}
                eventMarkers={eventMarkers}
                turningPoints={turningPoints}
                height={mainChartHeight}
                onCursorIdx={onCursorIdx}
                onEventMarkerDrag={onEventMarkerDrag}
                showET={showET}
                showTargetCurve={showTargetCurve}
                showRoR={showRoR}
                showRoRET={showRoRET}
                rorEtActual={rorEtActual}
                temperatureUnit={unit}
                xViewMin={effectiveZoomRange?.start}
                xViewMax={effectiveZoomRange?.end}
                controlData={controlData}
                showControlDrum={showControlDrum}
                showControlHeat={showControlHeat}
                showControlFan={showControlFan}
                controlChartHeightPct={controlChartHeightPct}
                controlYMin={controlYMin}
                controlYMax={controlYMax}
                phaseSegments={phaseSegments}
                tempMinC={tempMinC}
                tempMaxC={tempMaxC}
                rorYMin={rorYMin}
                rorYMax={rorYMax}
            />
        </div>
    );
};
