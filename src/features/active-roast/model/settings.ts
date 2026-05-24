import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'fc_roast_settings';

export type PollIntervalMs = 250 | 500 | 1000;
export type RorSpanSec = 15 | 30 | 60;
export type TemperatureUnit = 'C' | 'F';

export type RoastSettings = {
    pollIntervalMs: PollIntervalMs;
    rorSpanSec: RorSpanSec;
    temperatureUnit: TemperatureUnit;
    showET: boolean;
    showTargetCurve: boolean;
    showRoRChart: boolean;
    showRoRET: boolean;
    showControlChart: boolean;
    tempMinC: number;
    tempMaxC: number;
    rorYMin: number;
    rorYMax: number;
    yellowTempC: number;
    fcStartTempC: number;
    autoChargeDropC: number;
    preChargeDisplaySec: number;
};

const DEFAULT_SETTINGS: RoastSettings = {
    pollIntervalMs: 500,
    rorSpanSec: 30,
    temperatureUnit: 'C',
    showET: true,
    showTargetCurve: true,
    showRoRChart: true,
    showRoRET: false,
    showControlChart: true,
    tempMinC: 130,
    tempMaxC: 240,
    rorYMin: -5,
    rorYMax: 20,
    yellowTempC: 150,
    fcStartTempC: 200,
    autoChargeDropC: 5,
    preChargeDisplaySec: 60,
};

const isPollIntervalMs = (value: unknown): value is PollIntervalMs =>
    value === 250 || value === 500 || value === 1000;

const load = (): RoastSettings => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
            return {
                ...settings,
                pollIntervalMs: isPollIntervalMs(settings.pollIntervalMs)
                    ? settings.pollIntervalMs
                    : DEFAULT_SETTINGS.pollIntervalMs,
            };
        }
    } catch {
        // ignore
    }
    return { ...DEFAULT_SETTINGS };
};

let _settings = load();

const _listeners = new Set<() => void>();

const _subscribe = (listener: () => void) => {
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
};

const _getSnapshot = () => _settings;

export const updateRoastSettings = (patch: Partial<RoastSettings>) => {
    _settings = { ..._settings, ...patch };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_settings)); } catch { /* ignore */ }
    _listeners.forEach((l) => l());
};

export const useRoastSettings = () => useSyncExternalStore(_subscribe, _getSnapshot);
