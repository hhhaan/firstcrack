import type { CropsterSettingsSnapshot } from '@shared/types/cropster';
import type { RoastSettings } from '../model/roast-settings';
import { fromDisplayTemp, type TemperatureUnit } from './temperature';

export interface CropsterGraphField {
    field: string;
    value: unknown;
    target: string | null;
    status: 'mapped' | 'unsupported' | 'invalid';
}

export const cropsterTemperatureUnit = (value: unknown): TemperatureUnit | null => {
    if (value === 'CELSIUS') return 'C';
    if (value === 'FAHRENHEIT') return 'F';
    return null;
};

export const mapCropsterGraphSettings = (
    source: CropsterSettingsSnapshot,
    _previous: RoastSettings,
): { patch: Partial<RoastSettings>; fields: CropsterGraphField[] } => {
    const patch: Partial<RoastSettings> = {};
    const fields: CropsterGraphField[] = [];
    const add = (field: string, value: unknown, target: string | null, status: CropsterGraphField['status']) =>
        fields.push({ field, value, target, status });
    if (source.status !== 'found' || !source.preferences) return { patch, fields };
    if (source.preferences.version !== '5.13') {
        add('version', source.preferences.version, null, 'unsupported');
        return { patch, fields };
    }
    const preferences = source.preferences;
    const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    const unit = cropsterTemperatureUnit(preferences.temperatureUnit);
    if ('temperatureUnit' in preferences) {
        add('temperatureUnit', preferences.temperatureUnit, 'temperatureUnit', unit ? 'mapped' : 'invalid');
        if (unit) patch.temperatureUnit = unit;
    }

    const minTemp = preferences.minTemp;
    const maxTemp = preferences.maxTemp;
    if ('minTemp' in preferences || 'maxTemp' in preferences) {
        const toC = (value: number) => fromDisplayTemp(value, unit ?? 'C');
        const valid = unit && finite(minTemp) && finite(maxTemp) && minTemp < maxTemp;
        const inRange = valid && toC(minTemp) >= -100 && toC(maxTemp) <= 500;
        add('minTemp', minTemp, 'tempMinC', inRange ? 'mapped' : unit ? 'invalid' : 'unsupported');
        add('maxTemp', maxTemp, 'tempMaxC', inRange ? 'mapped' : unit ? 'invalid' : 'unsupported');
        if (inRange) {
            patch.tempMinC = toC(minTemp);
            patch.tempMaxC = toC(maxTemp);
        }
    }

    if ('time' in preferences) {
        const time = preferences.time;
        const minutes = finite(time) ? time / 60 : Number.NaN;
        const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 180;
        add('time', time, 'timeRangeMin', valid ? 'mapped' : 'invalid');
        if (valid) {
            patch.timeRangeMin = minutes;
            patch.timeRangeCustom = true;
        }
    }

    const minRiseRate = preferences.minRiseRate;
    const maxRiseRate = preferences.maxRiseRate;
    if ('minRiseRate' in preferences || 'maxRiseRate' in preferences) {
        const ror = preferences.ror;
        const factor = unit === 'F' ? 5 / 9 : 1;
        const valid =
            unit &&
            finite(ror) &&
            Number.isInteger(ror) &&
            ror >= 1 &&
            ror <= 3600 &&
            finite(minRiseRate) &&
            finite(maxRiseRate) &&
            minRiseRate < maxRiseRate;
        const min = valid ? minRiseRate * (60 / ror) * factor : Number.NaN;
        const max = valid ? maxRiseRate * (60 / ror) * factor : Number.NaN;
        const inRange = valid && min >= -1000 && max <= 1000;
        add('minRiseRate', minRiseRate, 'rorYMin', inRange ? 'mapped' : unit ? 'invalid' : 'unsupported');
        add('maxRiseRate', maxRiseRate, 'rorYMax', inRange ? 'mapped' : unit ? 'invalid' : 'unsupported');
        if ('ror' in preferences) add('ror', ror, null, inRange ? 'mapped' : unit ? 'invalid' : 'unsupported');
        if (inRange) {
            patch.rorYMin = min;
            patch.rorYMax = max;
        }
    }
    if ('ror' in preferences && !('minRiseRate' in preferences || 'maxRiseRate' in preferences))
        add('ror', preferences.ror, null, 'unsupported');
    for (const key of ['rorSmoothing', 'autoDetectionEnabled', 'autoStartEnabled', 'startThreshold', 'endThreshold']) {
        if (key in preferences) add(key, preferences[key], null, 'unsupported');
    }
    return { patch, fields };
};
