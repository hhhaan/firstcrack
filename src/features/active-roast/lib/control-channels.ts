import type { ControlLimit } from '@shared/types/sidecar';

export type ControlChannel = 'drum' | 'heat' | 'fan';

export const CONTROL_CHANNELS: readonly ControlChannel[] = ['drum', 'heat', 'fan'];

export const CONTROL_CHANNEL_LABEL: Record<ControlChannel, string> = { drum: 'Drum', heat: 'Heat', fan: 'Fan' };

export interface ControlChannelMeta {
    unit: string;
    /** Device write range. Absent when the machine does not report one. */
    min?: number;
    max?: number;
}

export type ControlUnits = Record<ControlChannel, ControlChannelMeta>;

/** Sidecar roles are `heater/fan/drum`; the chart says `heat`. */
export type ControlLimits = Partial<Record<'heater' | 'fan' | 'drum', ControlLimit>>;

// The app's long-standing labels (tooltip, settings copy). Used only when the device reports no unit.
const DEFAULT_UNITS: Record<ControlChannel, string> = { drum: 'RPM', heat: '%', fan: '%' };

const finite = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const metaFrom = (channel: ControlChannel, limit: ControlLimit | undefined): ControlChannelMeta => ({
    unit: (typeof limit?.unit === 'string' && limit.unit.trim()) || DEFAULT_UNITS[channel],
    min: finite(limit?.min),
    max: finite(limit?.max),
});

export const resolveControlUnits = (limits?: ControlLimits): ControlUnits => ({
    drum: metaFrom('drum', limits?.drum),
    heat: metaFrom('heat', limits?.heater),
    fan: metaFrom('fan', limits?.fan),
});

export const DEFAULT_CONTROL_UNITS: ControlUnits = resolveControlUnits();

/** Stable empty limits reference for live-status presentation. */
export const EMPTY_CONTROL_LIMITS: ControlLimits = {};

export type StickyControlLimitsCache = { identity: string; limits: ControlLimits } | null;

/**
 * Presentation limits for chart/readout axes.
 * Live `/status` wins when connected and fresh; otherwise reuse the last limits for this machine identity.
 */
export const resolveEffectiveControlLimits = (input: {
    cache: StickyControlLimitsCache;
    identity: string | null;
    statusLimits: ControlLimits | undefined;
    statusLimitsReceived: boolean;
    useStickyPresentation: boolean;
}): { cache: StickyControlLimitsCache; limits: ControlLimits | undefined } => {
    const { identity, statusLimits, statusLimitsReceived, useStickyPresentation } = input;
    let cache = input.cache;
    if (!identity) return { cache: null, limits: statusLimits };

    if (cache?.identity !== identity) cache = null;

    const liveStatus = statusLimitsReceived && !useStickyPresentation;
    if (liveStatus) {
        const limits = statusLimits ?? EMPTY_CONTROL_LIMITS;
        if (cache?.identity === identity && cache.limits === limits) {
            return { cache, limits };
        }
        return { cache: { identity, limits }, limits };
    }

    if (useStickyPresentation && cache?.identity === identity) {
        return { cache, limits: cache.limits };
    }

    return { cache, limits: statusLimits };
};

/** Span for change-label deadband — device range or full-series extent, not the zoomed axis window. */
export const deadbandSpanForChannel = (
    channel: ControlChannel,
    units: ControlUnits,
    fullSeries: readonly (number | null)[],
    axisFallback: { min: number; max: number },
): { min: number; max: number } => {
    const meta = units[channel];
    if (meta.min != null && meta.max != null && meta.max > meta.min) {
        return { min: meta.min, max: meta.max };
    }
    const extent = seriesExtent(fullSeries);
    if (extent) return extent;
    return axisFallback;
};

const isPercent = (unit: string) => unit === '%';

/** yAxis indices on the control grid. 4 is an unlabeled own-scale axis for a third unit. */
export const CONTROL_LEFT_AXIS = 2;
export const CONTROL_RIGHT_AXIS = 3;
export const CONTROL_OWN_SCALE_AXIS = 4;
export type ControlAxisIndex = typeof CONTROL_LEFT_AXIS | typeof CONTROL_RIGHT_AXIS | typeof CONTROL_OWN_SCALE_AXIS;

export interface ControlAxisSide {
    unit: string | null;
    channels: ControlChannel[];
    min: number;
    max: number;
}

export interface ControlAxisLayout {
    axisOf: Record<ControlChannel, ControlAxisIndex>;
    left: ControlAxisSide;
    right: ControlAxisSide;
    ownScale: ControlAxisSide;
}

/**
 * Device range when every channel on the axis reports one and the unit is not %.
 * % keeps the user's control range setting so the default band stays 0–100.
 */
const padRange = (min: number, max: number) => {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    if (max <= min) return { min: min - 1, max: max + 1 };
    const margin = (max - min) * 0.05;
    return { min: min - margin, max: max + margin };
};

const seriesExtent = (values: readonly (number | null)[] | undefined) => {
    const nums = (values ?? []).filter((v): v is number => v != null && Number.isFinite(v));
    if (nums.length === 0) return null;
    return padRange(Math.min(...nums), Math.max(...nums));
};

const axisRange = (
    channels: ControlChannel[],
    units: ControlUnits,
    fallbackMin: number,
    fallbackMax: number,
    dataByChannel?: Partial<Record<ControlChannel, readonly (number | null)[]>>,
): { min: number; max: number } => {
    const metas = channels.map((channel) => units[channel]);
    if (metas.length === 0) return { min: fallbackMin, max: fallbackMax };
    if (metas.some((meta) => isPercent(meta.unit))) return { min: fallbackMin, max: fallbackMax };
    const mins = metas.map((meta) => meta.min);
    const maxs = metas.map((meta) => meta.max);
    if (!mins.some((v) => v == null) && !maxs.some((v) => v == null)) {
        const min = Math.min(...(mins as number[]));
        const max = Math.max(...(maxs as number[]));
        if (max > min) return { min, max };
    }
    const extents = channels
        .map((channel) => seriesExtent(dataByChannel?.[channel]))
        .filter((e): e is { min: number; max: number } => e != null);
    if (extents.length > 0) {
        const min = Math.min(...extents.map((e) => e.min));
        const max = Math.max(...extents.map((e) => e.max));
        if (max > min) return { min, max };
    }
    return { min: fallbackMin, max: fallbackMax };
};

/**
 * Left axis = Drum, right axis = Heat. Fan joins whichever axis has its unit, else a free side.
 * A third distinct unit gets its own unlabeled scale instead of borrowing another unit's numbers.
 */
export const layoutControlAxes = (
    visible: Record<ControlChannel, boolean>,
    units: ControlUnits,
    fallbackMin: number,
    fallbackMax: number,
    dataByChannel?: Partial<Record<ControlChannel, readonly (number | null)[]>>,
): ControlAxisLayout => {
    const axisOf: Record<ControlChannel, ControlAxisIndex> = {
        drum: CONTROL_LEFT_AXIS,
        heat: CONTROL_RIGHT_AXIS,
        fan: CONTROL_RIGHT_AXIS,
    };
    const leftUnit = visible.drum ? units.drum.unit : null;
    const rightUnit = visible.heat ? units.heat.unit : null;
    if (visible.fan) {
        const fanUnit = units.fan.unit;
        if (rightUnit === fanUnit || rightUnit == null) axisOf.fan = CONTROL_RIGHT_AXIS;
        else if (leftUnit === fanUnit || leftUnit == null) axisOf.fan = CONTROL_LEFT_AXIS;
        else axisOf.fan = CONTROL_OWN_SCALE_AXIS;
    }
    const side = (axis: ControlAxisIndex): ControlAxisSide => {
        const channels = CONTROL_CHANNELS.filter((channel) => visible[channel] && axisOf[channel] === axis);
        return {
            unit: channels.length > 0 ? units[channels[0]].unit : null,
            channels,
            ...axisRange(channels, units, fallbackMin, fallbackMax, dataByChannel),
        };
    };
    return {
        axisOf,
        left: side(CONTROL_LEFT_AXIS),
        right: side(CONTROL_RIGHT_AXIS),
        ownScale: side(CONTROL_OWN_SCALE_AXIS),
    };
};

/** Integers stay integers; fractional readings keep one decimal. Null is never 0. */
export const formatControlValue = (value: number | null | undefined): string | null => {
    if (value == null || !Number.isFinite(value)) return null;
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

export const withUnit = (text: string, unit: string): string => (isPercent(unit) ? `${text}%` : `${text} ${unit}`);
