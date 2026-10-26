import type { getResolvedChartColors } from '@features/active-roast/lib/chart-config';
import type { CurveStyles } from '@features/active-roast/lib/curve-style';
import type { AppliedRoastControl, RoastNoteControls } from '@shared/types/roast';
import type { ReadUnits } from '@shared/types/sidecar';
import type { EventMarkerStyle, RoastSettings, TemperatureUnit } from '../../model/settings';
import type { PhaseSegment } from '../phases';
import type { TurningPoint } from '../turningPoints';

export type ResolvedChartColors = ReturnType<typeof getResolvedChartColors>;

export interface RoastEventMarker extends RoastNoteControls {
    /** Read-only event from the selected reference, drawn behind current events. */
    reference?: boolean;
    logId?: string;
    timeSec: number;
    event: string;
    color: string;
    timeStr: string;
    temp: string;
    tempC?: number | null;
    note?: string;
}

export interface ControlData {
    readUnits?: (ReadUnits | undefined)[];
    /** Successful app writes only; measured changes never create these labels. */
    changes?: { timeSec: number; values: AppliedRoastControl }[];
    xs: number[];
    drumTemp: (number | null)[];
    heatPower: (number | null)[];
    fanSpeed: (number | null)[];
    /** 사이드카가 쓴 heater 세트포인트 — 실측(heatPower) 위에 점선. 구 기록엔 없다 */
    heatSet?: (number | null)[];
    heatTarget?: { xs: number[]; values: number[] };
    /** Stored reference controls. Same time axis; missing channels stay null. Not Heat target/set. */
    reference?: {
        readUnits?: (ReadUnits | undefined)[];
        xs: number[];
        drum: (number | null)[];
        heater: (number | null)[];
        fan: (number | null)[];
    };
}

export interface ChartOptionParams {
    axisSettings?: Pick<RoastSettings, 'tempLabelInterval' | 'timeTickIntervalSec'> &
        Partial<
            Pick<
                RoastSettings,
                'tempTicksC' | 'timeMinorTickIntervalSec' | 'horizontalGridInterval' | 'rorTicksC' | 'rorLabelInterval'
            >
        >;
    /** Saved-record presentation: sparse grid, no instrument frame. */
    report?: boolean;
    /** White paper, with enough room for enlarged control labels. */
    print?: boolean;
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
    /** Stored-profile channels. Omitted = shown. Independent of the live series toggles. */
    showProfileBt?: boolean;
    showProfileEt?: boolean;
    showProfileRor?: boolean;
    showProfileEtRor?: boolean;
    showProfileDrum?: boolean;
    showProfileHeat?: boolean;
    showProfileFan?: boolean;
    /** Current-time BT−target ° label on the temp chart */
    showTargetDeltaLabel?: boolean;
    targetXs?: number[];
    targetBt?: (number | null)[];
    /** Stored reference ET/RoR on the same times as targetXs. Null = unstored sample, not zero. */
    targetEt?: (number | null)[];
    targetRor?: (number | null)[];
    targetEtRor?: (number | null)[];
    showRoR: boolean;
    showRoRET: boolean;
    rorEtActual: (number | null)[];
    controlData?: ControlData;
    showControlDrum: boolean;
    showControlHeat: boolean;
    showControlFan: boolean;
    controlChartHeightPct: number;
    mergeControlChart?: boolean;
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
    /** Gray interval on the shared temperature/control timeline. */
    bbpRange?: { start: number; end: number; label?: string };
    /** Live chart: omit Charge curve label (t=0 clips it). History keeps it. */
    hideChargeLabel?: boolean;
    /** 1, 1.5, or 2. Event, phase, target-delta, and BBP labels on the plot. Axes stay put. */
    fontScale?: number;
    colors: ResolvedChartColors;
    /** User line styles. Omitted = DESIGN.md defaults. */
    curveStyles?: CurveStyles;
}
