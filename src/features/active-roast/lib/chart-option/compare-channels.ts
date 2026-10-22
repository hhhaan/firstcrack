import type { ExtraSensorReading } from '@shared/types/sidecar';
import type { TemperatureUnit } from '../../model/settings';
import type { CurveChannel, CurveLineStyle, ResolvedCurveStyles } from '../curve-style';
import { rorUnitLabel, tempUnitLabel, toDisplayRoR, toDisplayTemp } from '../temperature';

export type ComparePoint = {
    t: number;
    bt: number;
    et: number | null;
    ror: number | null;
    rorEt?: number | null;
    heater?: number | null;
    heaterSet?: number | null;
    heaterUnit?: string;
    fan?: number | null;
    fanUnit?: string;
    drum?: number | null;
    drumUnit?: string;
    extraReadings?: ExtraSensorReading[];
};

export type CompareChannel = {
    key: string;
    label: string;
    unit: string;
    kind: 'temperature' | 'ror' | 'other';
    source: 'bt' | 'et' | 'ror' | 'rorEt' | 'heater' | 'heaterSet' | 'fan' | 'drum' | 'extra';
    sensorId?: string;
    sensorUnit?: string;
};

const CURVE_CHANNEL: Record<Exclude<CompareChannel['source'], 'extra'>, CurveChannel> = {
    bt: 'bt',
    et: 'et',
    ror: 'ror',
    rorEt: 'etRor',
    heater: 'heat',
    heaterSet: 'heat',
    fan: 'heat',
    drum: 'heat',
};

export const compareCurveStyle = (channel: CompareChannel, curves: ResolvedCurveStyles): CurveLineStyle => {
    if (channel.source === 'extra') {
        return curves[channel.kind === 'temperature' ? 'et' : channel.kind === 'ror' ? 'ror' : 'heat'].current;
    }
    return curves[CURVE_CHANNEL[channel.source]].current;
};

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
const normalizeExtraUnit = (unit: string): string => {
    const trimmed = unit.trim();
    const normalized = trimmed.replace(/^°/, '').toUpperCase();
    if (normalized === 'C') return '°C';
    if (normalized === 'C/MIN') return '°C/min';
    return trimmed;
};

export const isCompareControlChannel = (channel: CompareChannel): boolean =>
    channel.source === 'heater' ||
    channel.source === 'heaterSet' ||
    channel.source === 'fan' ||
    channel.source === 'drum';

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
        if (finite(point.heater)) {
            const unit = point.heaterUnit?.trim() || '%';
            const key = JSON.stringify(['heat', unit]);
            if (!seen.has(key)) {
                seen.add(key);
                channels.push({ key, label: 'Heat', unit, kind: 'other', source: 'heater' });
            }
        }
        if (finite(point.heaterSet)) {
            const unit = point.heaterUnit?.trim() || '%';
            const key = JSON.stringify(['gas', unit]);
            if (!seen.has(key)) {
                seen.add(key);
                channels.push({ key, label: 'Gas', unit, kind: 'other', source: 'heaterSet' });
            }
        }
        if (finite(point.fan)) {
            const unit = point.fanUnit?.trim() || '%';
            const key = JSON.stringify(['fan', unit]);
            if (!seen.has(key)) {
                seen.add(key);
                channels.push({ key, label: 'Fan', unit, kind: 'other', source: 'fan' });
            }
        }
        if (finite(point.drum)) {
            const unit = point.drumUnit?.trim() || 'RPM';
            const key = JSON.stringify(['drum', unit]);
            if (!seen.has(key)) {
                seen.add(key);
                channels.push({ key, label: 'Drum', unit, kind: 'other', source: 'drum' });
            }
        }
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
            : channel.source === 'heater'
              ? (point.heaterUnit?.trim() || '%') === channel.unit
                  ? point.heater
                  : null
              : channel.source === 'heaterSet'
                ? (point.heaterUnit?.trim() || '%') === channel.unit
                    ? point.heaterSet
                    : null
                : channel.source === 'fan'
                  ? (point.fanUnit?.trim() || '%') === channel.unit
                      ? point.fan
                      : null
                  : channel.source === 'drum'
                    ? (point.drumUnit?.trim() || 'RPM') === channel.unit
                        ? point.drum
                        : null
                    : point[channel.source];
    if (!finite(value)) return null;
    return channel.kind === 'temperature'
        ? toDisplayTemp(value, unit)
        : channel.kind === 'ror'
          ? toDisplayRoR(value, unit)
          : value;
};

/** Recorded samples are chronological; never interpolate commands or carry values beyond the recording. */
export const comparePointAtTime = (points: ComparePoint[], timeSec: number): ComparePoint | undefined => {
    if (!points.length || timeSec < points[0].t || timeSec > points[points.length - 1].t) return undefined;
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (points[mid].t <= timeSec) low = mid;
        else high = mid - 1;
    }
    return points[low];
};

export const compareOtherUnits = (channels: CompareChannel[]): string[] => [
    ...new Set(channels.filter((c) => c.kind === 'other').map((c) => c.unit)),
];

export const compareExtraAxisWidth = (channels: CompareChannel[]): number => compareOtherUnits(channels).length * 48;
