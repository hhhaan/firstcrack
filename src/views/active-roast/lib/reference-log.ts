import { storedEventsToLogEntries } from '@features/active-roast/lib/serialize-roast-events';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { withEditedHeaterLog } from '@features/machine-control/lib/heater-events';
import type { TsvPoint } from '@shared/lib/tsv';
import type { LogEntry, StoredRoastEvent } from '@shared/types/roast';

/** Reference data only. Reading it never changes the live log or the running Replay plan. */
export const buildReferenceLog = (
    events: StoredRoastEvent[],
    points: ReadonlyArray<Pick<TsvPoint, 't' | 'bt' | 'heaterSet' | 'processing'>>,
    unit: TemperatureUnit,
    storedHeatPlan: unknown = null,
): LogEntry[] => {
    const heaterUnit =
        points.find((point) => point.processing?.read_units?.heater)?.processing?.read_units?.heater ?? '';
    const edited = withEditedHeaterLog(events, storedHeatPlan, heaterUnit);
    if (storedHeatPlan != null) return storedEventsToLogEntries(edited, unit);
    let recorded = events;
    if (!events.some((event) => event.type === 'Heater' && event.time_sec >= 0)) {
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
    return storedEventsToLogEntries(recorded, unit);
};
