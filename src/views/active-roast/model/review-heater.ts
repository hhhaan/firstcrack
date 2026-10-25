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
export const heaterEventsFromLog = (
    entries: readonly LogEntry[],
    storedLog: readonly LogEntry[] | null,
    previousHeater: Json | null,
): Json | null => {
    const stored = (Array.isArray(previousHeater) ? previousHeater : []).flatMap((step) =>
        step !== null && typeof step === 'object' && !Array.isArray(step) ? [step] : [],
    );
    const stepsByTime = new Map<number, typeof stored>();
    for (const step of stored) {
        if (typeof step.t !== 'number') continue;
        const group = stepsByTime.get(step.t) ?? [];
        group.push(step);
        stepsByTime.set(step.t, group);
    }
    const takeStep = (entry: LogEntry) => {
        if (entry.current || entry.event !== 'Heater') return;
        const time = logEntryTimeSec(entry);
        const group = time == null ? undefined : stepsByTime.get(time);
        if (!group?.length) return;
        const match = group.findIndex((step) => step.bt === entry.tempC && step.heater === heaterValue(entry.note));
        return group.splice(Math.max(0, match), 1)[0];
    };
    // Match before edits/deletions reorder rows that share a timestamp.
    const stepsById = new Map<string, (typeof stored)[number]>();
    for (const entry of storedLog ?? []) {
        const step = takeStep(entry);
        if (entry.id && step) stepsById.set(entry.id, step);
    }
    const rows: { t: number; bt: number; heater: number }[] = [];
    for (const entry of entries) {
        if (entry.current || entry.event !== 'Heater') continue;
        const heater = heaterValue(entry.note);
        const t = logEntryTimeSec(entry);
        if (heater == null || t == null || !Number.isFinite(t) || t < 0) continue;
        const bt = entry.tempC != null && Number.isFinite(entry.tempC) ? entry.tempC : 0;
        const step = (entry.id ? stepsById.get(entry.id) : undefined) ?? takeStep(entry);
        rows.push({ ...step, t, bt, heater });
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
    storedLog: readonly LogEntry[],
): Json | null =>
    heaterSignature(previousLog) === heaterSignature(nextLog)
        ? previousHeater
        : heaterEventsFromLog(completeLog, storedLog, previousHeater);
