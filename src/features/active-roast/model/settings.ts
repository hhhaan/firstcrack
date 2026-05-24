import { useSyncExternalStore } from 'react';
import { LazyStore } from '@tauri-apps/plugin-store';

const LEGACY_STORAGE_KEY = 'fc_roast_settings';
const STORE_KEY = 'roast.settings';
const SAVE_DEBOUNCE_MS = 200;

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
    showPhaseBar: boolean;
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
    showPhaseBar: true,
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

const normalize = (raw: Partial<RoastSettings> | null | undefined): RoastSettings => {
    const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
    return {
        ...merged,
        pollIntervalMs: isPollIntervalMs(merged.pollIntervalMs)
            ? merged.pollIntervalMs
            : DEFAULT_SETTINGS.pollIntervalMs,
    };
};

const store = new LazyStore('settings.json');

let _settings: RoastSettings = { ...DEFAULT_SETTINGS };
let _userTouched = false;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

const _listeners = new Set<() => void>();

const _subscribe = (listener: () => void) => {
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
};

const _getSnapshot = () => _settings;

const _emit = () => _listeners.forEach((l) => l());

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
    try {
        await store.set(STORE_KEY, _settings);
        await store.save();
    } catch {
        // store unavailable — drop write
    }
};

const _scheduleSave = () => {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        _saveTimer = null;
        void _flush();
    }, SAVE_DEBOUNCE_MS);
};

const _hydrate = async () => {
    try {
        const stored = await store.get<Partial<RoastSettings>>(STORE_KEY);
        if (_userTouched) return;

        if (stored) {
            _settings = normalize(stored);
            _emit();
            return;
        }

        const legacy = _consumeLegacyLocalStorage();
        if (legacy) {
            _settings = normalize(legacy);
            _emit();
            await _flush();
        }
    } catch {
        // store unavailable (e.g., non-Tauri context) — keep defaults
    }
};

void _hydrate();

export const updateRoastSettings = (patch: Partial<RoastSettings>) => {
    _userTouched = true;
    _settings = normalize({ ..._settings, ...patch });
    _emit();
    _scheduleSave();
};

export const useRoastSettings = () => useSyncExternalStore(_subscribe, _getSnapshot);
