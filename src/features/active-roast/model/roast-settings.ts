import type { AlertSoundKind } from '../lib/alertSound';
import type { AutoChargeMode, AutoDropMode } from '../lib/autoCharge';
import type { CurveStyles } from '../lib/curve-style';
import type { RoastEventButtons } from '../lib/event-buttons';
import type { TemperatureUnit } from '../lib/temperature';

export type PollIntervalMs = 500 | 1000;
export type RorSpanSec = 15 | 30 | 60;
/** Labels drawn inside the roast chart. Stored as 100–200 (1×–2×). */
export type FontScalePct = number;
/** line = vertical lines on the temperature and control charts | tempLine = temperature chart only | point = dot on BT */
export type EventMarkerStyle = 'line' | 'tempLine' | 'point';
/**
 * DROP 시 PID가 풀릴 때 화력 처리.
 * 'hold' — 머신이 보고하는 현재 duty를 유지 (연속 배치 재승온 시간 절약)
 * 'zero' — 히터 0
 * 과열·쓰기 실패 등 이상 정지는 이 설정과 무관하게 항상 0을 시도한다.
 */
export type PidDropBehavior = 'hold' | 'zero';

/** Stored roast-screen settings. Persistence and normalization live in `settings.ts`. */
export type RoastSettings = {
    pollIntervalMs: PollIntervalMs;
    rorSpanSec: RorSpanSec;
    /** Display smoothing strength, 0–100. 0 shows the sensor sample. */
    btSmoothing: number;
    etSmoothing: number;
    /** RoR EMA strength, 0–100. 0 feeds sensor samples into the RoR span. */
    rorSmoothing: number;
    etRorSmoothing: number;
    temperatureUnit: TemperatureUnit;
    /** Stored chart scale: 100–200. Default 100 (slider 1%, actual 1×). */
    fontScalePct: FontScalePct;
    showET: boolean;
    showTargetCurve: boolean;
    /** Stored-profile channels. Independent of the live series toggles. */
    showProfileBt: boolean;
    showProfileEt: boolean;
    showProfileRor: boolean;
    showProfileEtRor: boolean;
    showProfileDrum: boolean;
    showProfileHeat: boolean;
    showProfileFan: boolean;
    /** Current-time BT−target ° label on the temp chart */
    showTargetDeltaLabel: boolean;
    showRoRChart: boolean;
    showRoRET: boolean;
    showControlChart: boolean;
    logExpanded: boolean;
    /** Drum / Heat / Fan series on the control band */
    showControlDrum: boolean;
    showControlHeat: boolean;
    showControlFan: boolean;
    /** Control band height as % of total chart height (12–40). */
    controlChartHeightPct: number;
    /** Shared control Y-axis range (Drum RPM / Heat% / Fan%). */
    controlYMin: number;
    controlYMax: number;
    showPhaseBar: boolean;
    /** FC Start–End vertical band on the temp chart */
    showFcBand: boolean;
    bbpEnabled: boolean;
    eventMarkerStyle: EventMarkerStyle;
    /** Which side-panel mark buttons are shown. Drop stays on. */
    eventButtons: RoastEventButtons;
    /** Per-channel line color, width, and dash for live and reference curves. */
    curveStyles: CurveStyles;
    tempMinC: number;
    tempMaxC: number;
    /** Intervals use the displayed unit. */
    tempGridInterval: number;
    tempGridPresetInterval: number;
    tempLabelPresetEvery: number;
    timeTickPresetSec: number;
    tempAxisMode: 'preset' | 'list';
    tempTickMode: 'interval' | 'list';
    tempLabelCustom: boolean;
    timeTickCustom: boolean;
    tempTicksC: number[];
    tempLabelEvery: number;
    timeTickIntervalSec: number;
    /** Null keeps the default subdivisions of the major time ticks. */
    timeMinorTickIntervalSec: number | null;
    /** Live chart time-axis floor, in minutes. The axis grows when the roast or profile is longer. */
    timeRangePresetMin: number;
    timeRangeCustom: boolean;
    timeRangeMin: number;
    /** Stored °C/min. Preset mode uses `rorGridPresetInterval` instead. */
    rorGridInterval: number;
    rorGridPresetInterval: number;
    /** `list` is the custom block, same naming as the temperature axis. */
    rorAxisMode: 'preset' | 'list';
    rorTickMode: 'interval' | 'list';
    rorTicksC: number[];
    rorLabelEvery: number;
    rorLabelPresetEvery: number;
    rorLabelCustom: boolean;
    rorYMin: number;
    rorYMax: number;
    yellowTempC: number;
    /** Independent: auto-mark Yellow when BT crosses yellowTempC after TP. */
    autoYellowEnabled: boolean;
    /**
     * When true, FC button/⌘2 cycles: empty → FC Start → FC Rolling → clear.
     * When false, classic toggle mark/unmark FC Start only.
     */
    fcDualMarkEnabled: boolean;
    autoChargeEnabled: boolean;
    autoChargeMode: AutoChargeMode;
    autoDropEnabled: boolean;
    autoDropMode: AutoDropMode;
    /**
     * Minutes after Charge before auto Drop may fire.
     * The detector fires only once elapsed exceeds this value (`elapsed > minutes * 60`).
     */
    autoDropStartMin: number;
    preChargeDisplaySec: number;
    /** Live threshold alarms (RoR crash / BT ceiling). */
    alertsEnabled: boolean;
    alertSoundEnabled: boolean;
    /** Which synthesized alarm plays. See lib/alertSound.ts. */
    alertSoundKind: AlertSoundKind;
    alertRorCrashCPerMin: number;
    alertBtMaxC: number;
    /** Minutes after Charge. Off by default. */
    alertAfterChargeEnabled: boolean;
    alertAfterChargeMin: number;
    /** Minutes before reference FC Start. Off by default; no-op without a target profile. */
    alertBeforeFcEnabled: boolean;
    alertBeforeFcMin: number;
    /** Minutes before reference Drop. Off by default; no-op without a target profile. */
    alertBeforeDropEnabled: boolean;
    alertBeforeDropMin: number;
    /** Minutes after session Drop. Off by default. Timer runs until End roast. */
    alertAfterDropEnabled: boolean;
    alertAfterDropMin: number;
    pidDropBehavior: PidDropBehavior;
};
