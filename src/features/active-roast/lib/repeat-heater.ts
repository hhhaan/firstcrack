import type { AppliedRoastControl, LogEntry } from '@shared/types/roast';

type HeaterMark = { event: string; note?: string | null; timeSec: number };

const heaterNumber = (note: string): number | null => {
    const match = note.trim().match(/^-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : null;
};

const latestMatching = (
    entries: readonly Pick<LogEntry, 'event' | 'note' | 'timeSec' | 'appliedControl'>[],
    readValue: (entry: Pick<LogEntry, 'event' | 'note' | 'appliedControl'>) => number | null,
): number | null => {
    let latest: { value: number; time: number; index: number } | null = null;
    entries.forEach((entry, index) => {
        const value = readValue(entry);
        if (value == null || !Number.isFinite(value)) return;
        const time = entry.timeSec ?? 0;
        if (!latest || time > latest.time || (time === latest.time && index > latest.index)) {
            latest = { value, time, index };
        }
    });
    return latest?.value ?? null;
};

const heaterMarkValue = (entry: Pick<LogEntry, 'event' | 'note' | 'appliedControl'>): number | null =>
    entry.event === 'Heater'
        ? heaterNumber(entry.note ?? '')
        : entry.event === 'Control' && typeof entry.appliedControl?.heater === 'number'
          ? entry.appliedControl.heater
          : null;

/** Latest setpoint from a chart mark or an earlier acknowledged write. */
export const latestHeaterSetpoint = (
    entries: readonly Pick<LogEntry, 'event' | 'note' | 'timeSec' | 'appliedControl'>[],
): number | null => latestMatching(entries, heaterMarkValue);

/** Acknowledged writes only. The Heater mark for the write in flight is not a previous change. */
const latestControlHeater = (
    entries: readonly Pick<LogEntry, 'event' | 'note' | 'timeSec' | 'appliedControl'>[],
): number | null =>
    latestMatching(entries, (entry) =>
        entry.event === 'Control' && typeof entry.appliedControl?.heater === 'number'
            ? entry.appliedControl.heater
            : null,
    );

export const isRepeatHeaterCommit = (
    entries: readonly Pick<LogEntry, 'event' | 'note' | 'timeSec' | 'appliedControl'>[],
    value: number,
): boolean => latestHeaterSetpoint(entries) === value;

/** Drop a heater role that does not change the setpoint. Other roles in the same write stay. */
export const controlValuesWithoutRepeatHeater = (
    entries: readonly Pick<LogEntry, 'event' | 'note' | 'timeSec' | 'appliedControl'>[],
    applied: AppliedRoastControl,
): AppliedRoastControl => {
    if (applied.heater === undefined || latestControlHeater(entries) !== applied.heater) return applied;
    const { heater: _heater, ...rest } = applied;
    return rest;
};

/** Keep the first chart label for a setpoint. A later identical heater click is not another mark. */
export const omitRepeatHeaterMarks = <T extends HeaterMark>(marks: readonly T[]): T[] => {
    const ranked = marks.map((mark, index) => ({ mark, index }));
    ranked.sort((a, b) => a.mark.timeSec - b.mark.timeSec || a.index - b.index);
    let previous: string | undefined;
    const drop = new Set<T>();
    for (const { mark } of ranked) {
        if (mark.event !== 'Heater') continue;
        const note = mark.note ?? '';
        if (previous === note) drop.add(mark);
        else previous = note;
    }
    return marks.filter((mark) => !drop.has(mark));
};
