import type { LogEntry } from '@shared/types/roast';
import type { ManualControlData } from './chart-option/types';
import { logEntryTimeSec } from './serialize-roast-events';

const numeric = (value: string | undefined): number | undefined => {
    if (value == null || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
};

/** Piecewise-constant operator observations. Samples/feedback are never rewritten. */
export const manualControlData = (
    entries: readonly LogEntry[],
    start: number,
    end: number,
): ManualControlData | undefined => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
    const ordered = entries
        .flatMap((entry, index) => {
            const time = logEntryTimeSec(entry);
            if (entry.event !== 'Note' || time == null || !Number.isFinite(time) || time > end) return [];
            const values = { heater: numeric(entry.gas), fan: numeric(entry.airflow), drum: numeric(entry.drum) };
            return Object.values(values).some((value) => value !== undefined) ? [{ time, index, values }] : [];
        })
        .sort((a, b) => a.time - b.time || a.index - b.index);
    if (!ordered.length) return undefined;
    const state: Record<'heater' | 'fan' | 'drum', number | null> = { heater: null, fan: null, drum: null };
    const result: ManualControlData = { xs: [], heater: [], fan: [], drum: [] };
    const append = (time: number) => {
        const last = result.xs.length - 1;
        if (result.xs[last] === time) {
            for (const role of ['heater', 'fan', 'drum'] as const) result[role][last] = state[role];
        } else {
            result.xs.push(time);
            for (const role of ['heater', 'fan', 'drum'] as const) result[role].push(state[role]);
        }
    };
    for (const row of ordered) {
        for (const role of ['heater', 'fan', 'drum'] as const)
            if (row.values[role] !== undefined) state[role] = row.values[role];
        append(Math.max(start, row.time));
    }
    append(end);
    return result;
};
