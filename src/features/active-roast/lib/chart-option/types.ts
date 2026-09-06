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

/** Replay On일 때 다음에 쓸 heater 이벤트 — Off이거나 소진이면 넘기지 않는다 (#369) */
export interface UpcomingHeaterMark {
    timeSec: number;
    btC: number;
    heater: number;
    remainingAfter: number;
    /** pre-TP: 컨트롤/시간축. post-TP: BT 가로선 */
    axis: 'time' | 'bt';
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
    /** Replay On + 다음 화력 이벤트가 있을 때만. Off면 생략 */
    upcomingHeaterMark?: UpcomingHeaterMark | null;
    turningPoints: TurningPoint[];
    temperatureUnit: TemperatureUnit;
    showET: boolean;
    showTargetCurve: boolean;
    /** Current-time BT−target ° label on the temp chart */
    showTargetDeltaLabel?: boolean;
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
    /** FC Start–End background band (default on) */
    showFcBand?: boolean;
    tempMinC: number;
    tempMaxC: number;
    rorYMin: number;
    rorYMax: number;
    xViewMin?: number;
    xViewMax?: number;
    colors: ResolvedChartColors;
}
