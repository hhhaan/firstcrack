import { logEntryTimeSec } from '@features/active-roast/lib/serialize-roast-events';
import type { Json } from '@shared/types/database.types';
import type { LogEntry } from '@shared/types/roast';

const heaterValue = (note: string | undefined): number | null => {
    const match = note?.trim().match(/^-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const value = Number(match[0]);
    return Number.isFinite(value) && value >= 0 ? value : null;
};

const heaterSignature = (entries: readonly LogEntry[] | null): string =>
    (entries ?? [])
        .filter((entry) => !entry.current && entry.event === 'Heater')
        .map((entry) => `${entry.id ?? ''}|${logEntryTimeSec(entry) ?? ''}|${entry.note ?? ''}|${entry.tempC ?? ''}`)
        .sort()
        .join('\n');

/** Heater marks → `roast_sessions.heater_events`. History draws Heat set from this plan. */
export const heaterEventsFromLog = (entries: readonly LogEntry[]): Json | null => {
    const rows: { t: number; bt: number; heater: number }[] = [];
    for (const entry of entries) {
        if (entry.current || entry.event !== 'Heater') continue;
        const heater = heaterValue(entry.note);
        const t = logEntryTimeSec(entry);
        if (heater == null || t == null || !Number.isFinite(t) || t < 0) continue;
        const bt = entry.tempC != null && Number.isFinite(entry.tempC) ? entry.tempC : 0;
        rows.push({ t, bt, heater });
    }
    rows.sort((a, b) => a.t - b.t);
    return rows.length > 0 ? rows : null;
};

/** Keep the stored plan unless a Heater mark itself changed. */
export const reviewHeaterToSave = (
    previousLog: readonly LogEntry[] | null,
    nextLog: readonly LogEntry[],
    previousHeater: Json | null,
    completeLog: readonly LogEntry[],
): Json | null =>
    heaterSignature(previousLog) === heaterSignature(nextLog) ? previousHeater : heaterEventsFromLog(completeLog);
