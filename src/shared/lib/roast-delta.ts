import type { StoredRoastEvent } from '@shared/types/roast';

/** Charge-relative event times used by roast metrics. */
export type NumericRoastEvent = Pick<StoredRoastEvent, 'type' | 'time_sec'>;

export type RoastMetricsEndSource = 'drop' | 'end' | 'legacy' | 'live';

export type RoastMetrics = {
    roastDurationSec: number | null;
    /** FC Start → roast end (same basis as duration). */
    devTimeSec: number | null;
    dtrPct: number | null;
    /** FC Rolling → same roast end; null unless FC Start ≤ Rolling < roast end. */
    rollingDevTimeSec: number | null;
    rollingDevPct: number | null;
    endSource: RoastMetricsEndSource | null;
};

export interface SessionDevMetrics {
    /** FC Start → roast end (canonical DTR). */
    devTimeSec: number | null;
    devPct: number | null;
    /** FC Rolling → roast end; null unless FC Start ≤ Rolling < roast end. */
    rollingDevTimeSec: number | null;
    rollingDevPct: number | null;
}

export const isValidTimeSec = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

const firstValidTime = (events: NumericRoastEvent[], type: string): number | undefined => {
    const t = events.find((e) => e.type === type)?.time_sec;
    return isValidTimeSec(t) ? t : undefined;
};

/** Coerce DB/json events to numeric marks. Invalid times are dropped. */
export const toNumericRoastEvents = (raw: unknown): NumericRoastEvent[] => {
    if (!Array.isArray(raw)) return [];
    const out: NumericRoastEvent[] = [];
    for (const item of raw) {
        if (item == null || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        if (typeof o.type !== 'string' || !isValidTimeSec(o.time_sec)) continue;
        out.push({ type: o.type, time_sec: o.time_sec });
    }
    return out;
};

const pickEnd = (
    events: NumericRoastEvent[],
    durationFallback?: number | null,
    liveElapsed?: number | null,
): { roastDurationSec: number | null; endSource: RoastMetricsEndSource | null } => {
    const drop = firstValidTime(events, 'Drop');
    if (drop != null) return { roastDurationSec: drop, endSource: 'drop' };
    const end = firstValidTime(events, 'End');
    if (end != null) return { roastDurationSec: end, endSource: 'end' };
    if (isValidTimeSec(durationFallback)) return { roastDurationSec: durationFallback, endSource: 'legacy' };
    if (isValidTimeSec(liveElapsed)) return { roastDurationSec: liveElapsed, endSource: 'live' };
    return { roastDurationSec: null, endSource: null };
};

const devFromAnchor = (
    anchorSec: number | undefined,
    end: number | null,
): { devTimeSec: number | null; devPct: number | null } => {
    if (anchorSec == null || end == null || end <= anchorSec) return { devTimeSec: null, devPct: null };
    const devTimeSec = end - anchorSec;
    return { devTimeSec, devPct: end > 0 ? (devTimeSec / end) * 100 : null };
};

export type DeriveRoastMetricsOpts = {
    /** Completed session `duration_seconds` (record End elapsed). Used only when Drop/End marks are missing. */
    durationFallback?: number | null;
    /** In-progress elapsed. Used only when Drop/End/legacy are missing. */
    liveElapsed?: number | null;
};

/**
 * Shared roast-metrics calc. Event times are Charge=0 seconds.
 * End basis: valid Drop → valid End → legacy duration_seconds → live elapsed.
 * DTR numerator and denominator share that same end. Does not round.
 */
export const deriveRoastMetrics = (events: NumericRoastEvent[], opts?: DeriveRoastMetricsOpts): RoastMetrics => {
    const { roastDurationSec, endSource } = pickEnd(events, opts?.durationFallback, opts?.liveElapsed);
    const fcStartSec = firstValidTime(events, 'FC Start');
    const start = devFromAnchor(fcStartSec, roastDurationSec);
    const rollingSec = firstValidTime(events, 'FC Rolling');
    const rolling = devFromAnchor(
        fcStartSec != null && rollingSec != null && fcStartSec <= rollingSec ? rollingSec : undefined,
        roastDurationSec,
    );
    return {
        roastDurationSec,
        devTimeSec: start.devTimeSec,
        dtrPct: start.devPct,
        rollingDevTimeSec: rolling.devTimeSec,
        rollingDevPct: rolling.devPct,
        endSource,
    };
};

/** Session-row helper: events jsonb + stored duration_seconds (record End). */
export const sessionRoastMetrics = (
    session: { events?: unknown; duration_seconds?: number | null },
    liveElapsed?: number | null,
): RoastMetrics =>
    deriveRoastMetrics(toNumericRoastEvents(session.events), {
        durationFallback: session.duration_seconds,
        liveElapsed,
    });

/** 세션 행에는 dev 필드가 없어 events에서 파생: FC Start/Rolling → Drop(없으면 End/duration). */
export const deriveSessionDevMetrics = (events: StoredRoastEvent[], durationSec: number | null): SessionDevMetrics => {
    const m = deriveRoastMetrics(events, { durationFallback: durationSec });
    return {
        devTimeSec: m.devTimeSec,
        devPct: m.dtrPct,
        rollingDevTimeSec: m.rollingDevTimeSec,
        rollingDevPct: m.rollingDevPct,
    };
};

/** 양쪽 값이 있을 때만 actual − target. */
export const deltaOrNull = (actual: number | null | undefined, target: number | null | undefined): number | null =>
    actual != null && target != null ? actual - target : null;
