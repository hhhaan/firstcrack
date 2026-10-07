import { logger } from '@shared/lib/logger';
import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import { useSyncExternalStore } from 'react';
import { type AlertSoundKind, isAlertSoundKind } from '../lib/alertSound';
import type { AutoChargeMode, AutoDropMode } from '../lib/autoCharge';
import { normalizeTemperatureTicks } from '../lib/temperature';

const LEGACY_STORAGE_KEY = 'fc_roast_settings';
const STORE_KEY = 'roast.settings';

export type PollIntervalMs = 500 | 1000;
export type RorSpanSec = 15 | 30 | 60;
/** 0 shows the raw sample, 50 keeps α 0.16, and 100 is the slowest α 0.08. */
export const btSmoothingToAlpha = (strength: number): number =>
    strength <= 50 ? 0.16 ** (strength / 50) : 0.16 * 2 ** ((50 - strength) / 50);
export type TemperatureUnit = 'C' | 'F';
/** Labels drawn inside the roast chart. Stored as 100–200 (1×–2×). */
export type FontScalePct = number;

export const FONT_SCALE_MIN = 100;
export const FONT_SCALE_MAX = 200;
/** Settings slider. 1 is the stored minimum, 100 is the stored maximum. */
export const FONT_SLIDER_MIN = 1;
export const FONT_SLIDER_MAX = 100;

const isFontScalePct = (value: unknown): value is FontScalePct =>
    typeof value === 'number' && Number.isInteger(value) && value >= FONT_SCALE_MIN && value <= FONT_SCALE_MAX;

export const fontScaleToSlider = (fontScalePct: number): number =>
    Math.round(
        ((fontScalePct - FONT_SCALE_MIN) * (FONT_SLIDER_MAX - FONT_SLIDER_MIN)) / (FONT_SCALE_MAX - FONT_SCALE_MIN),
    ) + FONT_SLIDER_MIN;

export const sliderToFontScale = (slider: number): FontScalePct =>
    FONT_SCALE_MIN +
    Math.round(((slider - FONT_SLIDER_MIN) * (FONT_SCALE_MAX - FONT_SCALE_MIN)) / (FONT_SLIDER_MAX - FONT_SLIDER_MIN));
/** line = vertical line | point = curve label | both = curve label + full-height line */
export type EventMarkerStyle = 'line' | 'point' | 'both';

export type RoastSettings = {
    pollIntervalMs: PollIntervalMs;
    rorSpanSec: RorSpanSec;
    /** Display smoothing strength, 0–100. 0 shows the sensor sample. */
    btSmoothing: number;
    etSmoothing: number;
    temperatureUnit: TemperatureUnit;
    /** Stored chart scale: 100–200. Default 100 (slider 1%, actual 1×). */
    fontScalePct: FontScalePct;
    showET: boolean;
    showTargetCurve: boolean;
    /** Stored-profile channels. Independent of the live series toggles. */
    showProfileBt: boolean;
    showProfileEt: boolean;
    showProfileRor: boolean;
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
    /** Live chart time-axis floor, in minutes. The axis grows when the roast or profile is longer. */
    timeRangePresetMin: number;
    timeRangeCustom: boolean;
    timeRangeMin: number;
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
    /**
     * DROP 시 PID가 풀릴 때 화력 처리.
     * 'hold' — 머신이 보고하는 현재 duty를 유지 (연속 배치 재승온 시간 절약)
     * 'zero' — 히터 0
     * 과열·쓰기 실패 등 이상 정지는 이 설정과 무관하게 항상 0을 시도한다.
     */
    pidDropBehavior: PidDropBehavior;
};

export type PidDropBehavior = 'hold' | 'zero';

/** Matches `CHART_TOTAL_SECS` (780s). Presets stay in display order, default first. */
export const TIME_RANGE_MIN_DEFAULT = 13;
export const TIME_RANGE_PRESET_MIN = [13, 10, 15, 20, 30] as const;
const TIME_RANGE_MIN_MAX = 180;

export const chartSpanSec = (
    settings: Pick<RoastSettings, 'timeRangeCustom' | 'timeRangeMin' | 'timeRangePresetMin'>,
): number => (settings.timeRangeCustom ? settings.timeRangeMin : settings.timeRangePresetMin) * 60;

/** Artisan autoDROP default: Charge 후 7분 초과. */
export const AUTO_DROP_START_MIN_DEFAULT = 7;
/**
 * Same ceiling as the other minute NumberInputs on RoastSettingsTab (time alarms).
 * Those inputs have no step; values are clamped into [1, 30].
 */
export const AUTO_DROP_START_MIN_MAX = 30;
const AUTO_DROP_START_MIN_MIN = 1;

const isPidDropBehavior = (v: unknown): v is PidDropBehavior => v === 'hold' || v === 'zero';

const DEFAULT_SETTINGS: RoastSettings = {
    pollIntervalMs: 1000,
    rorSpanSec: 30,
    btSmoothing: 0,
    etSmoothing: 0,
    temperatureUnit: 'C',
    fontScalePct: FONT_SCALE_MIN,
    showET: true,
    showTargetCurve: true,
    showProfileBt: true,
    showProfileEt: true,
    showProfileRor: true,
    showProfileDrum: true,
    showProfileHeat: true,
    showProfileFan: true,
    showTargetDeltaLabel: false,
    showRoRChart: true,
    showRoRET: false,
    showControlChart: true,
    logExpanded: false,
    showControlDrum: true,
    showControlHeat: true,
    showControlFan: true,
    controlChartHeightPct: 21,
    controlYMin: 0,
    controlYMax: 100,
    showPhaseBar: true,
    showFcBand: true,
    bbpEnabled: true,
    eventMarkerStyle: 'both',
    tempMinC: 130,
    tempMaxC: 240,
    tempGridInterval: 10,
    tempGridPresetInterval: 10,
    tempLabelPresetEvery: 5,
    timeTickPresetSec: 60,
    tempAxisMode: 'preset',
    tempTickMode: 'interval',
    tempLabelCustom: false,
    timeTickCustom: false,
    tempTicksC: [],
    tempLabelEvery: 5,
    timeTickIntervalSec: 60,
    timeRangePresetMin: TIME_RANGE_MIN_DEFAULT,
    timeRangeCustom: false,
    timeRangeMin: TIME_RANGE_MIN_DEFAULT,
    rorYMin: -5,
    rorYMax: 20,
    yellowTempC: 150,
    autoYellowEnabled: true,
    fcDualMarkEnabled: false,
    autoChargeEnabled: true,
    autoChargeMode: 'standard',
    autoDropEnabled: true,
    autoDropMode: 'standard',
    autoDropStartMin: AUTO_DROP_START_MIN_DEFAULT,
    preChargeDisplaySec: 60,
    alertsEnabled: true,
    alertSoundEnabled: true,
    alertSoundKind: 'pulse',
    alertRorCrashCPerMin: 0,
    alertBtMaxC: 250,
    alertAfterChargeEnabled: false,
    alertAfterChargeMin: 5,
    alertBeforeFcEnabled: false,
    alertBeforeFcMin: 1,
    alertBeforeDropEnabled: false,
    alertBeforeDropMin: 1,
    alertAfterDropEnabled: false,
    alertAfterDropMin: 5,
    pidDropBehavior: 'hold',
};

const clampNum = (value: unknown, min: number, max: number, fallback: number) => {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, n));
};

const asBool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

const pickPreset = (value: number, allowed: readonly number[], fallback: number): number =>
    allowed.includes(value) ? value : fallback;

const isPollIntervalMs = (value: unknown): value is PollIntervalMs => value === 500 || value === 1000;

/** Positive finite minutes only. 0 / negative / NaN / Infinity / non-numeric restore `previous` (or 7). */
const coerceAutoDropStartMin = (value: unknown, previous: number): number => {
    const fallback =
        typeof previous === 'number' &&
        Number.isFinite(previous) &&
        previous >= AUTO_DROP_START_MIN_MIN &&
        previous <= AUTO_DROP_START_MIN_MAX
            ? previous
            : AUTO_DROP_START_MIN_DEFAULT;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
    return Math.min(AUTO_DROP_START_MIN_MAX, Math.max(AUTO_DROP_START_MIN_MIN, value));
};

const isEventMarkerStyle = (value: unknown): value is EventMarkerStyle =>
    value === 'line' || value === 'point' || value === 'both';

const migratePollIntervalMs = (ms: unknown): PollIntervalMs => {
    if (ms === 250) return 500;
    return isPollIntervalMs(ms) ? ms : DEFAULT_SETTINGS.pollIntervalMs;
};

/**
 * 500ms polling is Pro-gated (FEATURE.fastPolling). Applied at read time, never persisted:
 * the profile RQ plan is empty until it resolves, so a persisted coercion (the 250→500
 * migration pattern) would clobber a Pro user's stored 500ms on every launch. Read-time
 * coercion also restores 500ms if the user re-upgrades.
 */
export const coercePollIntervalForPlan = (ms: PollIntervalMs, canFastPoll: boolean): PollIntervalMs =>
    ms === 500 && !canFastPoll ? 1000 : ms;

export const normalizeRoastSettings = (
    raw: Partial<RoastSettings> | null | undefined,
    previous?: RoastSettings,
): RoastSettings => {
    const {
        autoChargeDropC: _legacyChargeC,
        autoDropDropC: _legacyDropC,
        autoChargeConfirmC: _legacyChargeConfirm,
        autoDropConfirmC: _legacyDropConfirm,
        bbpWindowMinutes: _legacyBbpWindow,
        ...rest
    } = {
        ...(raw ?? {}),
    } as Partial<RoastSettings> & {
        autoChargeDropC?: unknown;
        autoDropDropC?: unknown;
        autoChargeConfirmC?: unknown;
        autoDropConfirmC?: unknown;
        /** Removed setting. Old stores may still contain it; it must not affect the cap. */
        bbpWindowMinutes?: unknown;
    };
    const merged = { ...DEFAULT_SETTINGS, ...rest };
    let controlYMin = clampNum(merged.controlYMin, -50, 500, DEFAULT_SETTINGS.controlYMin);
    let controlYMax = clampNum(merged.controlYMax, -50, 500, DEFAULT_SETTINGS.controlYMax);
    if (controlYMax <= controlYMin) {
        controlYMax = Math.min(500, controlYMin + 1);
        controlYMin = Math.max(-50, controlYMax - 1);
    }

    const yellowTempC = clampNum(merged.yellowTempC, 50, 300, DEFAULT_SETTINGS.yellowTempC);
    const autoYellowEnabled = asBool(merged.autoYellowEnabled, DEFAULT_SETTINGS.autoYellowEnabled);
    const fcDualMarkEnabled = asBool(merged.fcDualMarkEnabled, DEFAULT_SETTINGS.fcDualMarkEnabled);
    const tempTicksC =
        normalizeTemperatureTicks(merged.tempTicksC) ?? previous?.tempTicksC ?? DEFAULT_SETTINGS.tempTicksC;

    return {
        ...merged,
        tempGridPresetInterval: pickPreset(
            merged.tempGridPresetInterval,
            [10, 15, 20, 30],
            previous?.tempGridPresetInterval ?? 10,
        ),
        tempLabelPresetEvery: pickPreset(
            merged.tempLabelPresetEvery,
            [1, 2, 3, 5],
            previous?.tempLabelPresetEvery ?? 5,
        ),
        timeTickPresetSec: pickPreset(merged.timeTickPresetSec, [30, 60, 90, 120], previous?.timeTickPresetSec ?? 60),
        tempGridInterval:
            Number.isFinite(merged.tempGridInterval) && merged.tempGridInterval >= 1 && merged.tempGridInterval <= 500
                ? merged.tempGridInterval
                : (previous?.tempGridInterval ?? DEFAULT_SETTINGS.tempGridInterval),
        tempTicksC,
        tempAxisMode:
            rest.tempAxisMode === 'preset' || rest.tempAxisMode === 'list'
                ? rest.tempAxisMode
                : (previous?.tempAxisMode ?? (tempTicksC.length ? 'list' : 'preset')),
        tempTickMode:
            rest.tempTickMode === 'interval' || rest.tempTickMode === 'list'
                ? rest.tempTickMode
                : (previous?.tempTickMode ?? (tempTicksC.length ? 'list' : 'interval')),
        tempLabelCustom: asBool(rest.tempLabelCustom, previous?.tempLabelCustom ?? merged.tempLabelEvery !== 5),
        timeTickCustom: asBool(rest.timeTickCustom, previous?.timeTickCustom ?? merged.timeTickIntervalSec !== 60),
        tempLabelEvery:
            Number.isInteger(merged.tempLabelEvery) && merged.tempLabelEvery >= 1 && merged.tempLabelEvery <= 500
                ? merged.tempLabelEvery
                : (previous?.tempLabelEvery ?? DEFAULT_SETTINGS.tempLabelEvery),
        timeTickIntervalSec:
            Number.isInteger(merged.timeTickIntervalSec) &&
            merged.timeTickIntervalSec >= 1 &&
            merged.timeTickIntervalSec <= 3600
                ? merged.timeTickIntervalSec
                : (previous?.timeTickIntervalSec ?? DEFAULT_SETTINGS.timeTickIntervalSec),
        timeRangePresetMin: pickPreset(
            merged.timeRangePresetMin,
            TIME_RANGE_PRESET_MIN,
            previous?.timeRangePresetMin ?? TIME_RANGE_MIN_DEFAULT,
        ),
        timeRangeCustom: asBool(rest.timeRangeCustom, previous?.timeRangeCustom ?? false),
        timeRangeMin:
            Number.isInteger(merged.timeRangeMin) &&
            merged.timeRangeMin >= 1 &&
            merged.timeRangeMin <= TIME_RANGE_MIN_MAX
                ? merged.timeRangeMin
                : (previous?.timeRangeMin ?? TIME_RANGE_MIN_DEFAULT),
        pollIntervalMs: migratePollIntervalMs(merged.pollIntervalMs),
        btSmoothing: Math.round(clampNum(merged.btSmoothing, 0, 100, DEFAULT_SETTINGS.btSmoothing)),
        etSmoothing: Math.round(clampNum(merged.etSmoothing, 0, 100, DEFAULT_SETTINGS.etSmoothing)),
        fontScalePct: isFontScalePct(merged.fontScalePct) ? merged.fontScalePct : DEFAULT_SETTINGS.fontScalePct,
        eventMarkerStyle: isEventMarkerStyle(merged.eventMarkerStyle)
            ? merged.eventMarkerStyle
            : DEFAULT_SETTINGS.eventMarkerStyle,
        logExpanded: asBool(merged.logExpanded, DEFAULT_SETTINGS.logExpanded),
        showControlDrum: asBool(merged.showControlDrum, DEFAULT_SETTINGS.showControlDrum),
        showControlHeat: asBool(merged.showControlHeat, DEFAULT_SETTINGS.showControlHeat),
        showControlFan: asBool(merged.showControlFan, DEFAULT_SETTINGS.showControlFan),
        showProfileBt: asBool(merged.showProfileBt, DEFAULT_SETTINGS.showProfileBt),
        showProfileEt: asBool(merged.showProfileEt, DEFAULT_SETTINGS.showProfileEt),
        showProfileRor: asBool(merged.showProfileRor, DEFAULT_SETTINGS.showProfileRor),
        showProfileDrum: asBool(merged.showProfileDrum, DEFAULT_SETTINGS.showProfileDrum),
        showProfileHeat: asBool(merged.showProfileHeat, DEFAULT_SETTINGS.showProfileHeat),
        showProfileFan: asBool(merged.showProfileFan, DEFAULT_SETTINGS.showProfileFan),
        showTargetDeltaLabel: asBool(merged.showTargetDeltaLabel, DEFAULT_SETTINGS.showTargetDeltaLabel),
        showFcBand: asBool(merged.showFcBand, DEFAULT_SETTINGS.showFcBand),
        bbpEnabled: asBool(merged.bbpEnabled, DEFAULT_SETTINGS.bbpEnabled),
        controlChartHeightPct: clampNum(merged.controlChartHeightPct, 12, 40, DEFAULT_SETTINGS.controlChartHeightPct),
        controlYMin,
        controlYMax,
        yellowTempC,
        autoChargeEnabled: asBool(merged.autoChargeEnabled, DEFAULT_SETTINGS.autoChargeEnabled),
        autoChargeMode: merged.autoChargeMode === 'sensitive' ? 'sensitive' : 'standard',
        autoDropEnabled: asBool(merged.autoDropEnabled, DEFAULT_SETTINGS.autoDropEnabled),
        autoDropMode: merged.autoDropMode === 'sensitive' ? 'sensitive' : 'standard',
        autoDropStartMin: coerceAutoDropStartMin(
            merged.autoDropStartMin,
            previous?.autoDropStartMin ?? AUTO_DROP_START_MIN_DEFAULT,
        ),
        autoYellowEnabled,
        fcDualMarkEnabled,
        alertsEnabled: asBool(merged.alertsEnabled, DEFAULT_SETTINGS.alertsEnabled),
        alertSoundEnabled: asBool(merged.alertSoundEnabled, DEFAULT_SETTINGS.alertSoundEnabled),
        alertSoundKind: isAlertSoundKind(merged.alertSoundKind)
            ? merged.alertSoundKind
            : DEFAULT_SETTINGS.alertSoundKind,
        alertRorCrashCPerMin: clampNum(merged.alertRorCrashCPerMin, -20, 20, DEFAULT_SETTINGS.alertRorCrashCPerMin),
        alertBtMaxC: clampNum(merged.alertBtMaxC, 100, 400, DEFAULT_SETTINGS.alertBtMaxC),
        alertAfterChargeEnabled: asBool(merged.alertAfterChargeEnabled, DEFAULT_SETTINGS.alertAfterChargeEnabled),
        alertAfterChargeMin: clampNum(merged.alertAfterChargeMin, 1, 30, DEFAULT_SETTINGS.alertAfterChargeMin),
        alertBeforeFcEnabled: asBool(merged.alertBeforeFcEnabled, DEFAULT_SETTINGS.alertBeforeFcEnabled),
        alertBeforeFcMin: clampNum(merged.alertBeforeFcMin, 1, 30, DEFAULT_SETTINGS.alertBeforeFcMin),
        alertBeforeDropEnabled: asBool(merged.alertBeforeDropEnabled, DEFAULT_SETTINGS.alertBeforeDropEnabled),
        alertBeforeDropMin: clampNum(merged.alertBeforeDropMin, 1, 30, DEFAULT_SETTINGS.alertBeforeDropMin),
        alertAfterDropEnabled: asBool(merged.alertAfterDropEnabled, DEFAULT_SETTINGS.alertAfterDropEnabled),
        alertAfterDropMin: clampNum(merged.alertAfterDropMin, 1, 30, DEFAULT_SETTINGS.alertAfterDropMin),
        pidDropBehavior: isPidDropBehavior(merged.pidDropBehavior)
            ? merged.pidDropBehavior
            : DEFAULT_SETTINGS.pidDropBehavior,
    };
};

let _settings: RoastSettings = { ...DEFAULT_SETTINGS };
let _userTouched = false;

const _listeners = new Set<() => void>();

const _subscribe = (listener: () => void) => {
    _listeners.add(listener);
    return () => {
        _listeners.delete(listener);
    };
};

const _getSnapshot = () => _settings;

const _emit = () => {
    for (const l of _listeners) l();
};

const _consumeLegacyLocalStorage = (): Partial<RoastSettings> | null => {
    try {
        const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<RoastSettings>;
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        return parsed;
    } catch (err) {
        logger.capture(err, { scope: 'roastSettings.legacyLocalStorage' });
        return null;
    }
};

const _flush = async () => {
    await settingsSet(STORE_KEY, _settings, { debounce: true });
};

const _hydrate = async () => {
    try {
        const stored = await settingsGet<Partial<RoastSettings>>(STORE_KEY);
        if (_userTouched) return;

        if (stored) {
            _settings = normalizeRoastSettings(stored);
            if ((_settings.pollIntervalMs as number) === 250) {
                _settings = { ..._settings, pollIntervalMs: 500 };
                void _flush();
            }
            _emit();
            return;
        }

        const legacy = _consumeLegacyLocalStorage();
        if (legacy) {
            _settings = normalizeRoastSettings(legacy);
            _emit();
            await settingsSet(STORE_KEY, _settings);
        }
    } catch (err) {
        logger.capture(err, { scope: 'roastSettings.load' });
        // store unavailable (e.g., non-Tauri context) — keep defaults
    }
};

void _hydrate();

export const updateRoastSettings = (patch: Partial<RoastSettings>) => {
    _userTouched = true;
    _settings = normalizeRoastSettings({ ..._settings, ...patch }, _settings);
    _emit();
    void _flush();
};

export const useRoastSettings = () => useSyncExternalStore(_subscribe, _getSnapshot);

export const getRoastSettings = _getSnapshot;
