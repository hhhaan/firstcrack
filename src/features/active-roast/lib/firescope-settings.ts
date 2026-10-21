import type { FirescopeSettingsSnapshot } from '@shared/types/firescope';
import type { RoastSettings } from '../model/roast-settings';
import { type CurveChannel, isCurveColor } from './curve-style';
import { fromDisplayTemp, type TemperatureUnit } from './temperature';

export interface FirescopeGraphField {
    field: string;
    value: unknown;
    target: string | null;
    status: 'mapped' | 'unsupported' | 'invalid';
}

export const firescopeTemperatureUnit = (value: unknown): TemperatureUnit | null => {
    if (value === 'C' || value === '°C') return 'C';
    if (value === 'F' || value === '°F') return 'F';
    return null;
};

export const mapFirescopeGraphSettings = (
    source: FirescopeSettingsSnapshot,
    previous: RoastSettings,
    unit: TemperatureUnit | null,
): { patch: Partial<RoastSettings>; fields: FirescopeGraphField[] } => {
    const graph = source.graph ?? {};
    const patch: Partial<RoastSettings> = {};
    const fields: FirescopeGraphField[] = [];
    const handled = new Set<string>();
    const field = (key: string, target: string | null, status: FirescopeGraphField['status']) => {
        handled.add(key);
        if (key in graph) fields.push({ field: key, value: graph[key], target, status });
    };
    const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

    if (unit) {
        patch.temperatureUnit = unit;
        fields.push({ field: 'temperatureUnit', value: unit, target: 'temperatureUnit', status: 'mapped' });
    }
    if ('yAxisStart' in graph || 'yAxisEnd' in graph) {
        const min = graph.yAxisStart;
        const max = graph.yAxisEnd;
        const toC = (value: number) => fromDisplayTemp(value, unit ?? 'C');
        const valid = unit && finite(min) && finite(max) && min < max && toC(min) >= -100 && toC(max) <= 500;
        field('yAxisStart', 'tempMinC', valid ? 'mapped' : unit ? 'invalid' : 'unsupported');
        field('yAxisEnd', 'tempMaxC', valid ? 'mapped' : unit ? 'invalid' : 'unsupported');
        if (valid) {
            patch.tempMinC = toC(min);
            patch.tempMaxC = toC(max);
        }
    }
    if ('xAxisEnd' in graph) {
        const end = graph.xAxisEnd;
        const minutes = finite(end) ? end / 60 : Number.NaN;
        const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 180;
        field('xAxisEnd', 'timeRangeMin', valid ? 'mapped' : 'invalid');
        if (valid) {
            patch.timeRangeMin = minutes;
            patch.timeRangeCustom = true;
        }
    }
    if ('xAxisScaleUnit' in graph) {
        const tick = graph.xAxisScaleUnit;
        const valid = finite(tick) && Number.isInteger(tick) && tick >= 1 && tick <= 3600;
        field('xAxisScaleUnit', 'timeTickIntervalSec', valid ? 'mapped' : 'invalid');
        if (valid) {
            patch.timeTickIntervalSec = tick;
            patch.timeTickCustom = ![30, 60, 90, 120].includes(tick);
            if (!patch.timeTickCustom) patch.timeTickPresetSec = tick;
        }
    }
    if ('xAxisSubScaleUnit' in graph) {
        const tick = graph.xAxisSubScaleUnit;
        const major =
            graph.xAxisScaleUnit ??
            (previous.timeTickCustom ? previous.timeTickIntervalSec : previous.timeTickPresetSec);
        const valid =
            finite(tick) &&
            Number.isInteger(tick) &&
            tick >= 1 &&
            finite(major) &&
            major <= 3600 &&
            tick < major &&
            Number.isInteger(major / tick) &&
            major / tick <= 100;
        field('xAxisSubScaleUnit', 'timeMinorTickIntervalSec', valid ? 'mapped' : 'invalid');
        if (valid) patch.timeMinorTickIntervalSec = tick;
    }
    if ('yAxisScaleUnit' in graph) {
        const major = graph.yAxisScaleUnit;
        const valid = unit !== null && finite(major) && major >= 1 && major <= 250000;
        field('yAxisScaleUnit', 'tempLabelInterval', valid ? 'mapped' : 'invalid');
        if (valid) {
            patch.tempLabelInterval = major;
            patch.tempTickMode = 'interval';
        }
    }
    field('yAxisSubScaleUnit', null, 'unsupported');
    const colors: [string, CurveChannel][] = [
        ['btLineColor', 'bt'],
        ['etLineColor', 'et'],
        ['btRorLineColor', 'ror'],
        ['etRorLineColor', 'etRor'],
        ['burnerLineColor', 'heat'],
        ['drumSpeedLineColor', 'drum'],
        ['airflowLineColor', 'fan'],
    ];
    for (const [key, channel] of colors) {
        if (!(key in graph)) continue;
        const color = graph[key];
        field(key, `curveStyles.${channel}.color`, isCurveColor(color) ? 'mapped' : 'invalid');
        if (isCurveColor(color)) {
            patch.curveStyles ??= { ...previous.curveStyles };
            patch.curveStyles[channel] = { ...previous.curveStyles[channel], color: color.toLowerCase() };
        }
    }
    const visibility = {
        etLineVisible: 'showET',
        btRorLineVisible: 'showRoRChart',
        etRorLineVisible: 'showRoRET',
        burnerVisible: 'showControlHeat',
        drumSpeedVisible: 'showControlDrum',
        airflowVisible: 'showControlFan',
        extraValueVisible: 'showControlChart',
        recordGraphVisible: 'showTargetCurve',
    } as const;
    for (const [key, target] of Object.entries(visibility)) {
        if (!(key in graph)) continue;
        const visible = graph[key];
        field(key, target, typeof visible === 'boolean' ? 'mapped' : 'invalid');
        if (typeof visible === 'boolean') patch[target] = visible;
    }
    for (const [key, value] of Object.entries(graph)) {
        if (!handled.has(key)) fields.push({ field: key, value, target: null, status: 'unsupported' });
    }
    for (const [key, value] of Object.entries(source.indicator ?? {})) {
        fields.push({ field: `indicator.${key}`, value, target: null, status: 'unsupported' });
    }
    return { patch, fields };
};
