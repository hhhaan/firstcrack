import { resolveSourceSession } from '@entities/roast-profile';
import { parseStoredRoastEvents, storedEventsToLogEntries } from '@features/active-roast/lib/serialize-roast-events';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { withEditedHeaterLog } from '@features/machine-control/lib/heater-events';
import type { TsvPoint } from '@shared/lib/tsv';
import type { LogEntry, StoredRoastEvent } from '@shared/types/roast';

/** Profile replay conditions are instructions, not the source record's event coordinates. */
export const buildProfileReferenceLog = (
    profile:
        | { source_session?: Parameters<typeof resolveSourceSession>[0]; heater_events?: unknown }
        | null
        | undefined,
    points: ReadonlyArray<Pick<TsvPoint, 't' | 'bt' | 'heaterSet' | 'processing'>>,
    unit: TemperatureUnit,
): LogEntry[] => {
    const source = resolveSourceSession(profile?.source_session);
    return buildReferenceLog(parseStoredRoastEvents(source?.events), points, unit, source?.heater_events);
};

/** Reference data only. Reading it never changes the live log or the running Replay plan. */
export const buildReferenceLog = (
    events: StoredRoastEvent[],
    points: ReadonlyArray<Pick<TsvPoint, 't' | 'bt' | 'heaterSet' | 'processing'>>,
    unit: TemperatureUnit,
    storedHeatPlan: unknown = null,
): LogEntry[] => {
    const heaterUnit =
        points.find((point) => point.processing?.read_units?.heater)?.processing?.read_units?.heater ?? '';
    let recorded = events;
    if (!events.some((event) => event.type === 'Heater')) {
        const changes: StoredRoastEvent[] = [];
        let previous: number | null = null;
        for (const point of [...points].sort((a, b) => a.t - b.t)) {
            const value = point.heaterSet;
            if (point.t < 0 || value == null || !Number.isFinite(value) || value === previous) continue;
            changes.push({
                id: `reference-heat-${point.t}`,
                type: 'Heater',
                time_sec: point.t,
                temp_c: point.bt,
                note: `${value}${heaterUnit}`,
            });
            previous = value;
        }
        recorded = [...events, ...changes];
    }
    return storedEventsToLogEntries(withEditedHeaterLog(recorded, storedHeatPlan, heaterUnit), unit);
};
