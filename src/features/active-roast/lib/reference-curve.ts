import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { feedbackValue } from '@shared/lib/feedback';
import type { TsvPoint } from '@shared/lib/tsv';
import type { ReadUnits } from '@shared/types/sidecar';
import { toDisplayRoR, toDisplayTemp } from './temperature';

/** Display copy of a stored reference sample. heaterSet is intentionally absent. */
export interface ReferenceCurvePoint {
    readUnits?: ReadUnits;
    time: number;
    bt: number;
    et: number | null;
    ror: number | null;
    rorEt: number | null;
    heater: number | null;
    fan: number | null;
    drum: number | null;
}

const storedNumber = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Channels that were actually stored. Does not copy heaterSet (Heat target / Heat set own that)
 * and does not fill gaps with 0. ET RoR is only the stored ror_et column.
 */
export const referenceCurveFromPoints = (points: readonly TsvPoint[]): ReferenceCurvePoint[] =>
    points.map((p) => ({
        time: p.t,
        bt: p.bt,
        et: storedNumber(p.et),
        ror: storedNumber(p.ror),
        rorEt: storedNumber(p.rorEt),
        readUnits: p.processing?.read_units,
        heater: feedbackValue(p.heater, 'heater', p.processing?.read_units),
        fan: feedbackValue(p.fan, 'fan', p.processing?.read_units),
        drum: feedbackValue(p.drum, 'drum', p.processing?.read_units),
    }));

export const referenceCurveInRange = (
    curve: ReferenceCurvePoint[],
    range: { start: number; end: number } | null,
): ReferenceCurvePoint[] => (range ? curve.filter((p) => p.time >= range.start && p.time <= range.end) : curve);

export const toDisplayReferenceCurve = (curve: readonly ReferenceCurvePoint[], unit: TemperatureUnit) => ({
    readUnits: curve.map((p) => p.readUnits),
    xs: curve.map((p) => p.time),
    bt: curve.map((p) => toDisplayTemp(p.bt, unit)),
    et: curve.map((p) => (p.et == null ? null : toDisplayTemp(p.et, unit))),
    ror: curve.map((p) => (p.ror == null ? null : toDisplayRoR(p.ror, unit))),
    rorEt: curve.map((p) => (p.rorEt == null ? null : toDisplayRoR(p.rorEt, unit))),
    heater: curve.map((p) => p.heater),
    fan: curve.map((p) => p.fan),
    drum: curve.map((p) => p.drum),
});

export const referenceHasControls = (curve: readonly ReferenceCurvePoint[]): boolean =>
    curve.some((p) => p.heater != null || p.fan != null || p.drum != null);
