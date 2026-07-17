import type { EventMarkerStyle, PhaseSegment, TemperatureUnit, TurningPoint } from '@features/active-roast';
import type { getResolvedChartColors } from '@features/active-roast/lib/chart-config';

export type ResolvedChartColors = ReturnType<typeof getResolvedChartColors>;

export interface RoastEventMarker {
    timeSec: number;
    event: string;
    color: string;
    timeStr: string;
    temp: string;
}

export interface ControlData {
    xs: number[];
    drumTemp: (number | null)[];
    heatPower: (number | null)[];
    fanSpeed: (number | null)[];
}

export interface ChartOptionParams {
    xs: number[];
    btTarget: (number | null)[];
    btActual: (number | null)[];
    etActual: (number | null)[];
    rorActual: (number | null)[];
    currentTimeSec: number;
    charged: boolean;
    eventMarkerStyle: EventMarkerStyle;
    eventMarkers: RoastEventMarker[];
    turningPoints: TurningPoint[];
    temperatureUnit: TemperatureUnit;
    showET: boolean;
    showTargetCurve: boolean;
    targetXs?: number[];
    targetBt?: (number | null)[];
    showRoR: boolean;
    showRoRET: boolean;
    rorEtActual: (number | null)[];
    controlData?: ControlData;
    showControlDrum: boolean;
    showControlHeat: boolean;
    showControlFan: boolean;
    controlChartHeightPct: number;
    controlYMin: number;
    controlYMax: number;
    phaseSegments: PhaseSegment[];
    tempMinC: number;
    tempMaxC: number;
    rorYMin: number;
    rorYMax: number;
    xViewMin?: number;
    xViewMax?: number;
    colors: ResolvedChartColors;
}
