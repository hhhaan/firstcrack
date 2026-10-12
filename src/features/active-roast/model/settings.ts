import { logger } from '@shared/lib/logger';
import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import type { ArtisanSettingsSnapshot } from '@shared/types/artisan';
import type { CropsterSettingsSnapshot } from '@shared/types/cropster';
import type { FirescopeSettingsSnapshot } from '@shared/types/firescope';
import { useSyncExternalStore } from 'react';
import { isAlertSoundKind } from '../lib/alertSound';
import { mapArtisanGraphSettings } from '../lib/artisan-settings';
import { mapCropsterGraphSettings } from '../lib/cropster-settings';
import {
    type CurveChannel,
    type CurveChannelStyle,
    DEFAULT_CURVE_STYLES,
    normalizeCurveStyles,
} from '../lib/curve-style';
import { DEFAULT_EVENT_BUTTONS, normalizeEventButtons } from '../lib/event-buttons';
import { mapFirescopeGraphSettings } from '../lib/firescope-settings';
import { normalizeRorTicks, normalizeTemperatureTicks, type TemperatureUnit } from '../lib/temperature';
import type {
    EventMarkerStyle,
    FontScalePct,
    PidDropBehavior,
    PollIntervalMs,
    RoastSettings,
    RorSpanSec,
} from './roast-settings';

export type {
    EventMarkerStyle,
    FontScalePct,
    PidDropBehavior,
    PollIntervalMs,
    RoastSettings,
    RorSpanSec,
    TemperatureUnit,
};

const LEGACY_STORAGE_KEY = 'fc_roast_settings';
const STORE_KEY = 'roast.settings';

/** 0 shows the raw sample, 50 keeps α 0.16, and 100 is the slowest α 0.08. */
export const btSmoothingToAlpha = (strength: number): number =>
    strength <= 50 ? 0.16 ** (strength / 50) : 0.16 * 2 ** ((50 - strength) / 50);

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
    rorSmoothing: 0,
    etRorSmoothing: 0,
    temperatureUnit: 'C',
    fontScalePct: FONT_SCALE_MIN,
    showET: true,
    showTargetCurve: true,
    showProfileBt: true,
    showProfileEt: true,
    showProfileRor: true,
    showProfileEtRor: true,
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
    eventMarkerStyle: 'line',
    eventButtons: DEFAULT_EVENT_BUTTONS,
    curveStyles: DEFAULT_CURVE_STYLES,
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
    timeMinorTickIntervalSec: null,
    timeRangePresetMin: TIME_RANGE_MIN_DEFAULT,
    timeRangeCustom: false,
    timeRangeMin: TIME_RANGE_MIN_DEFAULT,
    rorGridInterval: 5,
    rorGridPresetInterval: 5,
    rorAxisMode: 'preset',
    rorTickMode: 'interval',
    rorTicksC: [],
    rorLabelEvery: 1,
    rorLabelPresetEvery: 1,
    rorLabelCustom: false,
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

const axisModeOf = (mode: unknown, previous: 'preset' | 'list' | undefined, custom: boolean): 'preset' | 'list' => {
    if (mode === 'preset' || mode === 'list') return mode;
    if (previous) return previous;
    return custom ? 'list' : 'preset';
};

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

/** Retired `both` was one line through both charts. Keep lines on each chart. */
const eventMarkerStyleOf = (value: unknown): EventMarkerStyle =>
    value === 'line' || value === 'tempLine' || value === 'point' ? value : 'line';

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

    let rorYMin = clampNum(merged.rorYMin, -100, 300, previous?.rorYMin ?? DEFAULT_SETTINGS.rorYMin);
    let rorYMax = clampNum(merged.rorYMax, -100, 300, previous?.rorYMax ?? DEFAULT_SETTINGS.rorYMax);
    if (rorYMax <= rorYMin) {
        rorYMin = previous?.rorYMin ?? DEFAULT_SETTINGS.rorYMin;
        rorYMax = previous?.rorYMax ?? DEFAULT_SETTINGS.rorYMax;
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
        timeMinorTickIntervalSec:
            merged.timeMinorTickIntervalSec === null ||
            (typeof merged.timeMinorTickIntervalSec === 'number' &&
                Number.isInteger(merged.timeMinorTickIntervalSec) &&
                merged.timeMinorTickIntervalSec >= 1 &&
                merged.timeMinorTickIntervalSec <= 3600)
                ? merged.timeMinorTickIntervalSec
                : (previous?.timeMinorTickIntervalSec ?? DEFAULT_SETTINGS.timeMinorTickIntervalSec),
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
        rorSmoothing: Math.round(clampNum(merged.rorSmoothing, 0, 100, DEFAULT_SETTINGS.rorSmoothing)),
        etRorSmoothing: Math.round(clampNum(merged.etRorSmoothing, 0, 100, DEFAULT_SETTINGS.etRorSmoothing)),
        fontScalePct: isFontScalePct(merged.fontScalePct) ? merged.fontScalePct : DEFAULT_SETTINGS.fontScalePct,
        eventMarkerStyle: eventMarkerStyleOf(merged.eventMarkerStyle),
        eventButtons: normalizeEventButtons(merged.eventButtons),
        logExpanded: asBool(merged.logExpanded, DEFAULT_SETTINGS.logExpanded),
        // curveStyles: invalid per-field values fall back to channel defaults (see normalizeCurveStyles), not prior settings.
        curveStyles: normalizeCurveStyles(merged.curveStyles),
        showControlDrum: asBool(merged.showControlDrum, DEFAULT_SETTINGS.showControlDrum),
        showControlHeat: asBool(merged.showControlHeat, DEFAULT_SETTINGS.showControlHeat),
        showControlFan: asBool(merged.showControlFan, DEFAULT_SETTINGS.showControlFan),
        showProfileBt: asBool(merged.showProfileBt, DEFAULT_SETTINGS.showProfileBt),
        showProfileEt: asBool(merged.showProfileEt, DEFAULT_SETTINGS.showProfileEt),
        showProfileRor: asBool(merged.showProfileRor, DEFAULT_SETTINGS.showProfileRor),
        showProfileEtRor: asBool(merged.showProfileEtRor, DEFAULT_SETTINGS.showProfileEtRor),
        showProfileDrum: asBool(merged.showProfileDrum, DEFAULT_SETTINGS.showProfileDrum),
        showProfileHeat: asBool(merged.showProfileHeat, DEFAULT_SETTINGS.showProfileHeat),
        showProfileFan: asBool(merged.showProfileFan, DEFAULT_SETTINGS.showProfileFan),
        showTargetDeltaLabel: asBool(merged.showTargetDeltaLabel, DEFAULT_SETTINGS.showTargetDeltaLabel),
        showFcBand: asBool(merged.showFcBand, DEFAULT_SETTINGS.showFcBand),
        bbpEnabled: asBool(merged.bbpEnabled, DEFAULT_SETTINGS.bbpEnabled),
        controlChartHeightPct: clampNum(merged.controlChartHeightPct, 12, 40, DEFAULT_SETTINGS.controlChartHeightPct),
        controlYMin,
        controlYMax,
        rorYMin,
        rorYMax,
        rorGridInterval: clampNum(
            merged.rorGridInterval,
            0.1,
            100,
            previous?.rorGridInterval ?? DEFAULT_SETTINGS.rorGridInterval,
        ),
        rorGridPresetInterval: pickPreset(
            merged.rorGridPresetInterval,
            [1, 2, 5, 10],
            previous?.rorGridPresetInterval ?? DEFAULT_SETTINGS.rorGridPresetInterval,
        ),
        rorAxisMode: axisModeOf(
            rest.rorAxisMode,
            previous?.rorAxisMode,
            merged.rorGridInterval !== DEFAULT_SETTINGS.rorGridInterval,
        ),
        rorTickMode:
            rest.rorTickMode === 'interval' || rest.rorTickMode === 'list'
                ? rest.rorTickMode
                : (previous?.rorTickMode ?? 'interval'),
        rorTicksC: normalizeRorTicks(merged.rorTicksC) ?? previous?.rorTicksC ?? DEFAULT_SETTINGS.rorTicksC,
        rorLabelCustom: asBool(rest.rorLabelCustom, previous?.rorLabelCustom ?? false),
        rorLabelPresetEvery: pickPreset(
            merged.rorLabelPresetEvery,
            [1, 2, 5],
            previous?.rorLabelPresetEvery ?? DEFAULT_SETTINGS.rorLabelPresetEvery,
        ),
        rorLabelEvery:
            Number.isInteger(merged.rorLabelEvery) && merged.rorLabelEvery >= 1 && merged.rorLabelEvery <= 100
                ? merged.rorLabelEvery
                : (previous?.rorLabelEvery ?? DEFAULT_SETTINGS.rorLabelEvery),
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

const hydration = _hydrate();

const importGraphSettings = async (mapPatch: (previous: RoastSettings) => Partial<RoastSettings>) => {
    await hydration;
    const patch = mapPatch(_settings);
    if (Object.keys(patch).length === 0) return;
    const next = normalizeRoastSettings({ ..._settings, ...patch }, _settings);
    _userTouched = true;
    await settingsSet(STORE_KEY, next, { throwOnError: true });
    _settings = next;
    _emit();
};

export const importFirescopeGraphSettings = (source: FirescopeSettingsSnapshot, unit: TemperatureUnit | null) =>
    importGraphSettings((previous) => mapFirescopeGraphSettings(source, previous, unit).patch);

export const importArtisanGraphSettings = (source: ArtisanSettingsSnapshot) =>
    importGraphSettings((previous) => mapArtisanGraphSettings(source, previous).patch);

export const importCropsterGraphSettings = (source: CropsterSettingsSnapshot) =>
    importGraphSettings((previous) => mapCropsterGraphSettings(source, previous).patch);

export const updateRoastSettings = (patch: Partial<RoastSettings>) => {
    _userTouched = true;
    _settings = normalizeRoastSettings({ ..._settings, ...patch }, _settings);
    _emit();
    void _flush();
};

/** Patches one channel. Other channels keep their stored style. */
export const updateCurveStyle = (channel: CurveChannel, patch: Partial<CurveChannelStyle>) => {
    const merged = { ..._settings.curveStyles[channel], ...patch };
    return updateRoastSettings({
        curveStyles: { ..._settings.curveStyles, [channel]: merged },
    });
};

export const resetCurveStyles = () => updateRoastSettings({ curveStyles: DEFAULT_CURVE_STYLES });

export const useRoastSettings = () => useSyncExternalStore(_subscribe, _getSnapshot);

export const getRoastSettings = _getSnapshot;
