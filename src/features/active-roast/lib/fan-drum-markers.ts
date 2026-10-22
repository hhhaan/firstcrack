import { getResolvedEventColor } from '@features/active-roast/lib/chart-config';
import type { RoastEventMarker } from '@features/active-roast/lib/chart-option/types';
import { formatSignedElapsed } from '@shared/lib/format';
import { parseEditTime } from '@shared/lib/time-edit';
import type { Json } from '@shared/types/database.types';
import type { AppliedRoastControl, LogEntry } from '@shared/types/roast';

type ControlRow = { id?: string; event: string; appliedControl?: AppliedRoastControl };

export const isFanDrumMarker = (event: string): event is 'Fan' | 'Drum' => event === 'Fan' || event === 'Drum';

export const controlMarkerLogId = (id: string, role: 'fan' | 'drum') => `${id}:${role}`;

export const parseControlMarkerLogId = (logId: string): { id: string; role: 'fan' | 'drum' } | null => {
    const split = logId.lastIndexOf(':');
    if (split <= 0) return null;
    const role = logId.slice(split + 1);
    if (role !== 'fan' && role !== 'drum') return null;
    return { id: logId.slice(0, split), role };
};

const controlValueText = (value: number) => String(Number(value.toFixed(2)));

/** One chart marker per fan or drum write that differs from the previous write of that role. */
export const fanDrumMarkers = (
    rows: readonly { id?: string; timeSec: number; values: AppliedRoastControl }[],
): RoastEventMarker[] => {
    const previous: Partial<Record<'fan' | 'drum', number>> = {};
    const markers: RoastEventMarker[] = [];
    for (const row of [...rows].sort((a, b) => a.timeSec - b.timeSec)) {
        if (!row.id || !Number.isFinite(row.timeSec)) continue;
        for (const role of ['fan', 'drum'] as const) {
            const value = row.values[role];
            if (value === undefined || !Number.isFinite(value) || previous[role] === value) continue;
            previous[role] = value;
            const event = role === 'fan' ? 'Fan' : 'Drum';
            const timeSec = row.timeSec;
            markers.push({
                logId: controlMarkerLogId(row.id, role),
                timeSec,
                event,
                color: getResolvedEventColor(event),
                timeStr: formatSignedElapsed(timeSec),
                temp: '',
                tempC: null,
                note: controlValueText(value),
            });
        }
    }
    return markers;
};

export const fanDrumMarkersFromLog = (entries: readonly LogEntry[]): RoastEventMarker[] =>
    fanDrumMarkers(
        entries.flatMap((entry) => {
            const timeSec = entry.timeSec ?? parseEditTime(entry.time);
            if (entry.event !== 'Control' || !entry.id || !entry.appliedControl || timeSec == null) return [];
            return [{ id: entry.id, timeSec, values: entry.appliedControl }];
        }),
    );

export const fanDrumMarkersFromStored = (
    events: readonly { id: string; type: string; time_sec: number; applied_control?: AppliedRoastControl }[],
): RoastEventMarker[] =>
    fanDrumMarkers(
        events.flatMap((event) =>
            event.type === 'Control' && event.applied_control
                ? [{ id: event.id, timeSec: event.time_sec, values: event.applied_control }]
                : [],
        ),
    );

/** Saved Control row behind a fan/drum chart label. Time and that role's value can change. */
export const patchStoredControl = (
    raw: unknown,
    logId: string,
    patch: { timeSec?: number; note?: string },
): Json | null => {
    const parsed = parseControlMarkerLogId(logId);
    if (!parsed || !Array.isArray(raw)) return null;
    const nextValue = patch.note == null ? undefined : Number(patch.note);
    if (patch.note != null && !Number.isFinite(nextValue)) return null;
    let found = false;
    const next = raw.map((item) => {
        if (item == null || typeof item !== 'object' || Array.isArray(item)) return item;
        const row = item as Record<string, unknown>;
        if (row.id !== parsed.id || row.type !== 'Control') return item;
        found = true;
        const applied =
            row.applied_control != null &&
            typeof row.applied_control === 'object' &&
            !Array.isArray(row.applied_control)
                ? { ...(row.applied_control as Record<string, unknown>) }
                : {};
        if (nextValue != null) applied[parsed.role] = nextValue;
        const timeSec =
            patch.timeSec != null && Number.isFinite(patch.timeSec)
                ? Math.min(5999, Math.max(0, Math.round(patch.timeSec)))
                : row.time_sec;
        return { ...row, time_sec: timeSec, applied_control: applied };
    });
    return found ? (next as Json) : null;
};

/** Drop one fan or drum value. The Control row stays so a saved record can keep the other roles. */
export const dropControlRole = <T extends ControlRow>(entries: readonly T[], logId: string): T[] | null => {
    const parsed = parseControlMarkerLogId(logId);
    if (!parsed) return null;
    let found = false;
    const next = entries.map((entry) => {
        if (entry.id !== parsed.id || entry.event !== 'Control' || !entry.appliedControl) return entry;
        found = true;
        const applied = { ...entry.appliedControl };
        delete applied[parsed.role];
        return { ...entry, appliedControl: applied };
    });
    return found ? next : null;
};

export const dropStoredControlRole = (raw: unknown, logId: string): Json | null => {
    const parsed = parseControlMarkerLogId(logId);
    if (!parsed || !Array.isArray(raw)) return null;
    let found = false;
    const next = raw.map((item) => {
        if (item == null || typeof item !== 'object' || Array.isArray(item)) return item;
        const row = item as Record<string, unknown>;
        if (row.id !== parsed.id || row.type !== 'Control') return item;
        const applied =
            row.applied_control != null &&
            typeof row.applied_control === 'object' &&
            !Array.isArray(row.applied_control)
                ? { ...(row.applied_control as Record<string, unknown>) }
                : null;
        if (!applied || !(parsed.role in applied)) return item;
        found = true;
        delete applied[parsed.role];
        return { ...row, applied_control: applied };
    });
    return found ? (next as Json) : null;
};
