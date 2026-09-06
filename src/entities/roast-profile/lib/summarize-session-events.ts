import type { StoredRoastEvent } from '@shared/types/roast';

/** Profile summary columns, every one derived from a single session's event marks. */
export type SessionSummary = {
    charge_temp_celsius: number | null;
    drop_temp_celsius: number | null;
    /** Drop mark time — End (timer stop) only when Drop was never marked. */
    duration_sec: number | null;
    /** FC Start mark — not a DB column; drives dev_time_sec and the #351 time alarms. */
    fc_time_sec: number | null;
    dev_time_sec: number | null;
    dev_pct: number | null;
};

type SessionFallback = { duration_seconds: number | null; drop_temp_celsius: number | null };

/** DB columns are integer → round. */
const roundOrNull = (v: number | null | undefined): number | null =>
    v != null && Number.isFinite(v) ? Math.round(v) : null;

export const summarizeSessionEvents = (events: StoredRoastEvent[], fallback: SessionFallback): SessionSummary => {
    const find = (type: string) => events.find((e) => e.type === type);
    const charge = find('Charge');
    const fc = find('FC Start');
    const drop = find('Drop');
    const end = find('End');

    const duration_sec = roundOrNull(drop?.time_sec ?? end?.time_sec ?? fallback.duration_seconds);
    const fc_time_sec = roundOrNull(fc?.time_sec);
    const dev_time_sec =
        duration_sec != null && fc_time_sec != null && duration_sec > fc_time_sec ? duration_sec - fc_time_sec : null;
    // dev_pct column is real — keep one decimal
    const dev_pct = dev_time_sec != null && duration_sec ? Math.round((dev_time_sec / duration_sec) * 1000) / 10 : null;

    return {
        charge_temp_celsius: roundOrNull(charge?.temp_c),
        drop_temp_celsius: roundOrNull(drop?.temp_c ?? fallback.drop_temp_celsius),
        duration_sec,
        fc_time_sec,
        dev_time_sec,
        dev_pct,
    };
};
