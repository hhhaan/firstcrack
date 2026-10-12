import type { ArtisanSettingsSnapshot } from '@shared/types/artisan';
import type { RoastSettings } from '../model/roast-settings';
import { type CurveChannel, isCurveColor } from './curve-style';
import { fromDisplayTemp, type TemperatureUnit } from './temperature';

export interface ArtisanGraphField {
    field: string;
    value: unknown;
    target: string | null;
    status: 'mapped' | 'unsupported' | 'invalid';
}

export const artisanTemperatureUnit = (value: unknown): TemperatureUnit | null =>
    value === 'C' || value === 'F' ? value : null;

export const mapArtisanGraphSettings = (
    source: ArtisanSettingsSnapshot,
    previous: RoastSettings,
): { patch: Partial<RoastSettings>; fields: ArtisanGraphField[] } => {
    const settings = source.status === 'found' ? (source.settings ?? {}) : {};
    const patch: Partial<RoastSettings> = {};
    const fields: ArtisanGraphField[] = [];
    const add = (field: string, value: unknown, target: string | null, status: ArtisanGraphField['status']) =>
        fields.push({ field, value, target, status });
    const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    const unit = artisanTemperatureUnit(settings.Mode);
    if ('Mode' in settings) {
        add('Mode', settings.Mode, 'temperatureUnit', unit ? 'mapped' : 'invalid');
        if (unit) patch.temperatureUnit = unit;
    }

    const ymin = settings['Axis/ymin'];
    const ymax = settings['Axis/ymax'];
    if ('Axis/ymin' in settings || 'Axis/ymax' in settings) {
        const toC = (value: number) => fromDisplayTemp(value, unit ?? 'C');
        const valid = unit && finite(ymin) && finite(ymax) && ymin < ymax && toC(ymin) >= -100 && toC(ymax) <= 500;
        add('Axis/ymin', ymin, 'tempMinC', valid ? 'mapped' : unit ? 'invalid' : 'unsupported');
        add('Axis/ymax', ymax, 'tempMaxC', valid ? 'mapped' : unit ? 'invalid' : 'unsupported');
        if (valid) {
            patch.tempMinC = toC(ymin);
            patch.tempMaxC = toC(ymax);
        }
    }
    if ('Axis/xmin' in settings || 'Axis/xmax' in settings) {
        const xmin = settings['Axis/xmin'];
        const xmax = settings['Axis/xmax'];
        const minutes = finite(xmax) ? xmax / 60 : Number.NaN;
        const valid = xmin === 0 && Number.isInteger(minutes) && minutes >= 1 && minutes <= 180;
        if ('Axis/xmin' in settings) add('Axis/xmin', xmin, null, xmin === 0 ? 'mapped' : 'unsupported');
        if ('Axis/xmax' in settings) add('Axis/xmax', xmax, 'timeRangeMin', valid ? 'mapped' : 'invalid');
        if (valid) {
            patch.timeRangeMin = minutes;
            patch.timeRangeCustom = true;
        }
    }

    const colors = settings.Colors;
    if ('Colors' in settings && (colors === null || typeof colors !== 'object' || Array.isArray(colors))) {
        add('Colors', colors, null, 'invalid');
    } else if (colors && typeof colors === 'object') {
        const palette = colors as Record<string, unknown>;
        const mappings: [string, CurveChannel][] = [
            ['bt', 'bt'],
            ['et', 'et'],
            ['deltabt', 'ror'],
            ['deltaet', 'etRor'],
        ];
        for (const [key, channel] of mappings) {
            if (!(key in palette)) continue;
            const color = palette[key];
            add(`Colors.${key}`, color, `curveStyles.${channel}.color`, isCurveColor(color) ? 'mapped' : 'invalid');
            if (isCurveColor(color)) {
                patch.curveStyles ??= { ...previous.curveStyles };
                patch.curveStyles[channel] = { ...previous.curveStyles[channel], color: color.toLowerCase() };
            }
        }
    }

    for (const key of ['BTfunction', 'ETfunction', 'ChannelTares', 'events', 'Alarms', 'Sliders']) {
        if (key in settings) add(key, settings[key], null, 'unsupported');
    }
    return { patch, fields };
};
