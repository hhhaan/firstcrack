import { deriveRoastMetrics, isValidTimeSec } from '@shared/lib/roast-delta';
import type { StoredRoastEvent } from '@shared/types/roast';

/** Profile summary columns, every one derived from a single session's event marks. */
export type SessionSummary = {
    charge_temp_celsius: number | null;
    drop_temp_celsius: number | null;
    /** Roast duration — Drop-first, then End, then stored duration_seconds. */
    duration_sec: number | null;
    /** FC Start mark — not a DB column; drives dev_time_sec and the #351 time alarms. */
    fc_time_sec: number | null;
    dev_time_sec: number | null;
    dev_pct: number | null;
};

type SessionFallback = { duration_seconds: number | null; drop_temp_celsius: number | null };

/** DB columns are integer → round at the save boundary only. */
const roundOrNull = (v: number | null | undefined): number | null =>
    v != null && Number.isFinite(v) ? Math.round(v) : null;

export const summarizeSessionEvents = (events: StoredRoastEvent[], fallback: SessionFallback): SessionSummary => {
    const find = (type: string) => events.find((e) => e.type === type);
    const charge = find('Charge');
    const fc = find('FC Start');
    const drop = find('Drop');
    const metrics = deriveRoastMetrics(events, { durationFallback: fallback.duration_seconds });

    return {
        charge_temp_celsius: roundOrNull(charge?.temp_c),
        drop_temp_celsius: roundOrNull(drop?.temp_c ?? fallback.drop_temp_celsius),
        duration_sec: roundOrNull(metrics.roastDurationSec),
        fc_time_sec: roundOrNull(isValidTimeSec(fc?.time_sec) ? fc.time_sec : null),
        dev_time_sec: roundOrNull(metrics.devTimeSec),
        // dev_pct column is real — keep one decimal at the save boundary
        dev_pct:
            metrics.dtrPct != null && Number.isFinite(metrics.dtrPct) ? Math.round(metrics.dtrPct * 10) / 10 : null,
    };
};
