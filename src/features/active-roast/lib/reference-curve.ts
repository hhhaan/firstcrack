import type { TemperatureUnit } from '@features/active-roast/model/settings';
import type { TsvPoint } from '@shared/lib/tsv';
import { toDisplayRoR, toDisplayTemp } from './temperature';

/** Display copy of a stored reference sample. heaterSet is intentionally absent. */
export interface ReferenceCurvePoint {
    time: number;
    bt: number;
    et: number | null;
    ror: number | null;
    heater: number | null;
    fan: number | null;
    drum: number | null;
}

const storedNumber = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Channels that were actually stored. Does not copy heaterSet (Heat target / Heat set own that)
 * and does not invent ET RoR or fill gaps with 0.
 */
export const referenceCurveFromPoints = (points: readonly TsvPoint[]): ReferenceCurvePoint[] =>
    points.map((p) => ({
        time: p.t,
        bt: p.bt,
        et: storedNumber(p.et),
        ror: storedNumber(p.ror),
        heater: storedNumber(p.heater),
        fan: storedNumber(p.fan),
        drum: storedNumber(p.drum),
    }));

export const referenceCurveInRange = (
    curve: ReferenceCurvePoint[],
    range: { start: number; end: number } | null,
): ReferenceCurvePoint[] => (range ? curve.filter((p) => p.time >= range.start && p.time <= range.end) : curve);

export const toDisplayReferenceCurve = (curve: readonly ReferenceCurvePoint[], unit: TemperatureUnit) => ({
    xs: curve.map((p) => p.time),
    bt: curve.map((p) => toDisplayTemp(p.bt, unit)),
    et: curve.map((p) => (p.et == null ? null : toDisplayTemp(p.et, unit))),
    ror: curve.map((p) => (p.ror == null ? null : toDisplayRoR(p.ror, unit))),
    heater: curve.map((p) => p.heater),
    fan: curve.map((p) => p.fan),
    drum: curve.map((p) => p.drum),
});

export const referenceHasControls = (curve: readonly ReferenceCurvePoint[]): boolean =>
    curve.some((p) => p.heater != null || p.fan != null || p.drum != null);
