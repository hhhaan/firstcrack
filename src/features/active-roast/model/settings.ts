import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import { useSyncExternalStore } from 'react';

const LEGACY_STORAGE_KEY = 'fc_roast_settings';
const STORE_KEY = 'roast.settings';

export type PollIntervalMs = 500 | 1000;
export type RorSpanSec = 15 | 30 | 60;
export type TemperatureUnit = 'C' | 'F';
/** line = vertical markLine | point = curve markPoint + label box */
export type EventMarkerStyle = 'line' | 'point';

export type RoastSettings = {
    pollIntervalMs: PollIntervalMs;
    rorSpanSec: RorSpanSec;
    temperatureUnit: TemperatureUnit;
    showET: boolean;
    showTargetCurve: boolean;
    /** Current-time BT−target ° label on the temp chart */
    showTargetDeltaLabel: boolean;
    showRoRChart: boolean;
    showRoRET: boolean;
    showControlChart: boolean;
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
    eventMarkerStyle: EventMarkerStyle;
    tempMinC: number;
    tempMaxC: number;
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
    autoChargeDropC: number;
    /** BT drop within the detection window that auto-marks Drop (after 3 min). */
    autoDropDropC: number;
    preChargeDisplaySec: number;
    /** Live threshold alarms (RoR crash / BT ceiling). */
    alertsEnabled: boolean;
    alertSoundEnabled: boolean;
    alertRorCrashCPerMin: number;
    alertBtMaxC: number;
    /**
     * DROP 시 PID가 풀릴 때 화력 처리.
     * 'hold' — 머신이 보고하는 현재 duty를 유지 (연속 배치 재승온 시간 절약)
     * 'zero' — 히터 0
     * 과열·쓰기 실패 등 이상 정지는 이 설정과 무관하게 항상 0을 시도한다.
     */
    pidDropBehavior: PidDropBehavior;
};

export type PidDropBehavior = 'hold' | 'zero';

const isPidDropBehavior = (v: unknown): v is PidDropBehavior => v === 'hold' || v === 'zero';

const DEFAULT_SETTINGS: RoastSettings = {
    pollIntervalMs: 500,
    rorSpanSec: 30,
    temperatureUnit: 'C',
    showET: true,
    showTargetCurve: true,
    showTargetDeltaLabel: false,
    showRoRChart: true,
    showRoRET: false,
    showControlChart: true,
    showControlDrum: true,
    showControlHeat: true,
    showControlFan: true,
    controlChartHeightPct: 21,
    controlYMin: 0,
    controlYMax: 100,
    showPhaseBar: true,
    showFcBand: true,
    eventMarkerStyle: 'point',
    tempMinC: 130,
    tempMaxC: 240,
    rorYMin: -5,
    rorYMax: 20,
    yellowTempC: 150,
    autoYellowEnabled: true,
    fcDualMarkEnabled: false,
    autoChargeDropC: 5,
    autoDropDropC: 8,
    preChargeDisplaySec: 60,
    alertsEnabled: true,
    alertSoundEnabled: true,
    alertRorCrashCPerMin: 0,
    alertBtMaxC: 250,
    pidDropBehavior: 'hold',
};

const clampNum = (value: unknown, min: number, max: number, fallback: number) => {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, n));
};

const asBool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

const isPollIntervalMs = (value: unknown): value is PollIntervalMs => value === 500 || value === 1000;

const isEventMarkerStyle = (value: unknown): value is EventMarkerStyle => value === 'line' || value === 'point';

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

export const normalizeRoastSettings = (raw: Partial<RoastSettings> | null | undefined): RoastSettings => {
    const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
    let controlYMin = clampNum(merged.controlYMin, -50, 500, DEFAULT_SETTINGS.controlYMin);
    let controlYMax = clampNum(merged.controlYMax, -50, 500, DEFAULT_SETTINGS.controlYMax);
    if (controlYMax <= controlYMin) {
        controlYMax = Math.min(500, controlYMin + 1);
        controlYMin = Math.max(-50, controlYMax - 1);
    }

    const yellowTempC = clampNum(merged.yellowTempC, 50, 300, DEFAULT_SETTINGS.yellowTempC);
    const autoYellowEnabled = asBool(merged.autoYellowEnabled, DEFAULT_SETTINGS.autoYellowEnabled);
    const fcDualMarkEnabled = asBool(merged.fcDualMarkEnabled, DEFAULT_SETTINGS.fcDualMarkEnabled);

    return {
        ...merged,
        pollIntervalMs: migratePollIntervalMs(merged.pollIntervalMs),
        eventMarkerStyle: isEventMarkerStyle(merged.eventMarkerStyle)
            ? merged.eventMarkerStyle
            : DEFAULT_SETTINGS.eventMarkerStyle,
        showControlDrum: asBool(merged.showControlDrum, DEFAULT_SETTINGS.showControlDrum),
        showControlHeat: asBool(merged.showControlHeat, DEFAULT_SETTINGS.showControlHeat),
        showControlFan: asBool(merged.showControlFan, DEFAULT_SETTINGS.showControlFan),
        showTargetDeltaLabel: asBool(merged.showTargetDeltaLabel, DEFAULT_SETTINGS.showTargetDeltaLabel),
        showFcBand: asBool(merged.showFcBand, DEFAULT_SETTINGS.showFcBand),
        controlChartHeightPct: clampNum(merged.controlChartHeightPct, 12, 40, DEFAULT_SETTINGS.controlChartHeightPct),
        controlYMin,
        controlYMax,
        yellowTempC,
        autoDropDropC: clampNum(merged.autoDropDropC, 2, 30, DEFAULT_SETTINGS.autoDropDropC),
        autoYellowEnabled,
        fcDualMarkEnabled,
        alertsEnabled: asBool(merged.alertsEnabled, DEFAULT_SETTINGS.alertsEnabled),
        alertSoundEnabled: asBool(merged.alertSoundEnabled, DEFAULT_SETTINGS.alertSoundEnabled),
        alertRorCrashCPerMin: clampNum(merged.alertRorCrashCPerMin, -20, 20, DEFAULT_SETTINGS.alertRorCrashCPerMin),
        alertBtMaxC: clampNum(merged.alertBtMaxC, 100, 400, DEFAULT_SETTINGS.alertBtMaxC),
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
    } catch {
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
    } catch {
        // store unavailable (e.g., non-Tauri context) — keep defaults
    }
};

void _hydrate();

export const updateRoastSettings = (patch: Partial<RoastSettings>) => {
    _userTouched = true;
    _settings = normalizeRoastSettings({ ..._settings, ...patch });
    _emit();
    void _flush();
};

export const useRoastSettings = () => useSyncExternalStore(_subscribe, _getSnapshot);
