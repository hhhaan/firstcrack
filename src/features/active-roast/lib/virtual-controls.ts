import type { AppliedRoastControl, RoastNoteControls } from '@shared/types/roast';
import type { ControlData } from './chart-option/types';

export type VirtualControlChange = NonNullable<ControlData['changes']>[number];

const ROLES = ['heater', 'fan', 'drum'] as const;

const hasSample = (values: readonly (number | null)[] | undefined) =>
    values?.some((value) => value != null && Number.isFinite(value)) ?? false;

/** Leading number from a right-click field. "50%" and "1.2 kPa" count. Words do not. */
export const parseManualControlNumber = (value: string | undefined): number | undefined => {
    const match = /^(\d+(?:\.\d+)?)/.exec(value?.trim() ?? '');
    if (!match) return undefined;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
};

/** Notes typed during the roast. Negative BBP times stay notes, not control steps. */
export const manualNotesToControlChanges = (
    entries: readonly (RoastNoteControls & { event?: string; timeSec?: number | null })[],
): VirtualControlChange[] =>
    entries.flatMap((entry) => {
        if (entry.event != null && entry.event !== 'Note') return [];
        if (entry.timeSec == null || !Number.isFinite(entry.timeSec) || entry.timeSec < 0) return [];
        const values: AppliedRoastControl = {};
        const heater = parseManualControlNumber(entry.gas);
        const fan = parseManualControlNumber(entry.airflow);
        const drum = parseManualControlNumber(entry.drum);
        if (heater != null) values.heater = heater;
        if (fan != null) values.fan = fan;
        if (drum != null) values.drum = drum;
        return Object.keys(values).length ? [{ timeSec: entry.timeSec, values, virtual: true }] : [];
    });

/** Last command at or before each sample. Nothing is invented before the first command. */
export const holdControlSamples = (
    xs: readonly number[],
    changes: readonly VirtualControlChange[],
    role: (typeof ROLES)[number],
): (number | null)[] => {
    const ordered = [...changes]
        .filter((change) => Number.isFinite(change.timeSec))
        .sort((a, b) => a.timeSec - b.timeSec);
    let cursor = 0;
    let current: number | null = null;
    return xs.map((time) => {
        while (cursor < ordered.length && ordered[cursor].timeSec <= time) {
            const value = ordered[cursor].values[role];
            if (value != null && Number.isFinite(value)) current = value;
            cursor += 1;
        }
        return current;
    });
};

/** Channels the machine never reported keep a step line from right-click notes and acknowledged writes. */
export const withVirtualControlLines = (data: ControlData): ControlData => {
    const changes = data.changes ?? [];
    const virtualRoles: (typeof ROLES)[number][] = [];
    const paint = (values: (number | null)[], role: (typeof ROLES)[number]) => {
        if (hasSample(values)) return values;
        const held = holdControlSamples(data.xs, changes, role);
        if (!hasSample(held)) return values;
        virtualRoles.push(role);
        return held;
    };
    return {
        ...data,
        heatPower: paint(data.heatPower, 'heater'),
        fanSpeed: paint(data.fanSpeed, 'fan'),
        drumTemp: paint(data.drumTemp, 'drum'),
        virtualRoles,
    };
};
