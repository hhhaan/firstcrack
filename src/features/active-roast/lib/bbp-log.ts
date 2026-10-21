import { formatElapsed } from '@shared/lib/format';
import type { LogEntry, StoredBbpEvent } from '@shared/types/roast';
import type { TemperatureUnit } from '../model/settings';
import { getResolvedEventColor } from './chart-config';
import type { RoastEventMarker } from './chart-option';
import { formatTemp } from './temperature';

/** Same offset as the curve: live window origin, or archived BBP duration before Charge. */
export const bbpEventsToLog = (
    events: readonly StoredBbpEvent[],
    offset: number,
    unit: TemperatureUnit,
    beforeCharge = false,
): LogEntry[] =>
    events
        .map((event) => {
            const timeSec = beforeCharge ? Math.min(0, event.t - offset) : event.t - offset;
            return {
                id: event.id,
                event: event.event,
                timeSec,
                time: `${timeSec < 0 ? '-' : ''}${formatElapsed(Math.abs(timeSec))}`,
                tempC: event.tempC,
                temp: formatTemp(event.tempC, unit),
                note: event.note,
                ...(event.carried && { bbpCarry: true }),
                ...(event.gas !== undefined && { gas: event.gas }),
                ...(event.airflow !== undefined && { airflow: event.airflow }),
                ...(event.drum !== undefined && { drum: event.drum }),
            };
        })
        .sort((a, b) => a.timeSec - b.timeSec);

/** Archive events have no editable roast log id. */
export const bbpLogMarkers = (entries: readonly LogEntry[]): RoastEventMarker[] =>
    entries
        .filter((entry) => !entry.bbpCarry)
        .map((entry) => ({
            timeSec: entry.timeSec ?? 0,
            event: entry.event,
            color: getResolvedEventColor(entry.event),
            timeStr: entry.time,
            temp: entry.temp,
            tempC: entry.tempC,
            note: entry.note,
            ...(entry.gas !== undefined && { gas: entry.gas }),
            ...(entry.airflow !== undefined && { airflow: entry.airflow }),
            ...(entry.drum !== undefined && { drum: entry.drum }),
        }));
