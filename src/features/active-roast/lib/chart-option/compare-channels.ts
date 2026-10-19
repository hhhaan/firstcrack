import type { ExtraSensorReading } from '@shared/types/sidecar';
import type { TemperatureUnit } from '../../model/settings';
import { rorUnitLabel, tempUnitLabel, toDisplayRoR, toDisplayTemp } from '../temperature';

export type ComparePoint = {
    t: number;
    bt: number;
    et: number | null;
    ror: number | null;
    rorEt?: number | null;
    extraReadings?: ExtraSensorReading[];
};

export type CompareChannel = {
    key: string;
    label: string;
    unit: string;
    kind: 'temperature' | 'ror' | 'other';
    source: 'bt' | 'et' | 'ror' | 'rorEt' | 'extra';
    sensorId?: string;
    sensorUnit?: string;
};

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
const normalizeExtraUnit = (unit: string): string => {
    const trimmed = unit.trim();
    const normalized = trimmed.replace(/^°/, '').toUpperCase();
    if (normalized === 'C') return '°C';
    if (normalized === 'C/MIN') return '°C/min';
    return trimmed;
};

/** Only channels actually recorded in at least one session are offered. */
export const compareChannels = (series: { points: ComparePoint[] }[], unit: TemperatureUnit): CompareChannel[] => {
    const points = series.flatMap((s) => s.points);
    const builtins = [
        { key: 'bt', label: 'BT', source: 'bt', unit: tempUnitLabel(unit), kind: 'temperature' },
        { key: 'et', label: 'ET', source: 'et', unit: tempUnitLabel(unit), kind: 'temperature' },
        { key: 'ror', label: 'BT RoR', source: 'ror', unit: rorUnitLabel(unit), kind: 'ror' },
        { key: 'rorEt', label: 'ET RoR', source: 'rorEt', unit: rorUnitLabel(unit), kind: 'ror' },
    ] satisfies CompareChannel[];
    const channels: CompareChannel[] = builtins.filter((channel) => points.some((p) => finite(p[channel.source])));
    const seen = new Set<string>();
    for (const point of points) {
        for (const sensor of point.extraReadings ?? []) {
            const sensorUnit = normalizeExtraUnit(sensor.unit);
            const key = JSON.stringify(['extra', sensor.id, sensor.label, sensorUnit]);
            if (seen.has(key) || !finite(sensor.value)) continue;
            seen.add(key);
            const kind = sensorUnit === '°C' ? 'temperature' : sensorUnit === '°C/min' ? 'ror' : 'other';
            channels.push({
                key,
                label: sensor.label,
                unit: kind === 'temperature' ? tempUnitLabel(unit) : kind === 'ror' ? rorUnitLabel(unit) : sensorUnit,
                kind,
                source: 'extra',
                sensorId: sensor.id,
                sensorUnit,
            });
        }
    }
    return channels;
};

export const compareChannelValue = (
    point: ComparePoint,
    channel: CompareChannel,
    unit: TemperatureUnit,
): number | null => {
    const value =
        channel.source === 'extra'
            ? point.extraReadings?.find(
                  (s) =>
                      s.id === channel.sensorId &&
                      s.label === channel.label &&
                      normalizeExtraUnit(s.unit) === channel.sensorUnit,
              )?.value
            : point[channel.source];
    if (!finite(value)) return null;
    return channel.kind === 'temperature'
        ? toDisplayTemp(value, unit)
        : channel.kind === 'ror'
          ? toDisplayRoR(value, unit)
          : value;
};

export const compareOtherUnits = (channels: CompareChannel[]): string[] => [
    ...new Set(channels.filter((c) => c.kind === 'other').map((c) => c.unit)),
];

export const compareExtraAxisWidth = (channels: CompareChannel[]): number => compareOtherUnits(channels).length * 48;
