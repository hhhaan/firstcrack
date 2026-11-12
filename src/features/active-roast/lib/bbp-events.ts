import { formatElapsed } from '@shared/lib/format';
import type { AppliedRoastControl, LogEntry, RoastNoteControls } from '@shared/types/roast';
import type { TemperatureUnit } from '../model/settings';
import { BBP_MAX_SECONDS } from './bbp-types';
import { hasNoteControl, noteControlFields } from './manual-controls';
import { formatTemp } from './temperature';

const BBP_ALLOWED_EVENTS = new Set(['Note', 'Heater', 'Control']);

/** Crack / Drop / Charge stay roast-only. Notes, heat, and control writes can sit on BBP. */
export const isBbpAllowedEvent = (event: string): boolean => BBP_ALLOWED_EVENTS.has(event);

export const bbpWindowOrigin = (endT: number, windowSeconds = BBP_MAX_SECONDS) => Math.max(0, endT - windowSeconds);

export const bbpDisplayTime = (storedSec: number, origin: number) => storedSec - origin;

export const bbpStoredTime = (displaySec: number, origin: number) => displaySec + origin;

/** Live chart times start at the left of the kept window. */
export const bbpEventsForDisplay = (events: readonly LogEntry[], origin: number): LogEntry[] =>
    events.flatMap((entry) => {
        if (entry.timeSec == null || !Number.isFinite(entry.timeSec)) return [];
        const timeSec = bbpDisplayTime(entry.timeSec, origin);
        if (timeSec < 0) return [];
        return [{ ...entry, timeSec, time: formatElapsed(timeSec) }];
    });

export const bbpEventsFromDisplay = (events: readonly LogEntry[], origin: number): LogEntry[] =>
    events.map((entry) => {
        const timeSec = bbpStoredTime(entry.timeSec ?? 0, origin);
        return { ...entry, timeSec };
    });

export const makeBbpLogEntry = (
    event: string,
    note: string,
    timeSec: number,
    tempC: number | null,
    unit: TemperatureUnit,
    extra?: RoastNoteControls & { appliedControl?: AppliedRoastControl },
): LogEntry | null => {
    if (!isBbpAllowedEvent(event) || !Number.isFinite(timeSec)) return null;
    const body = note.trim();
    const fields = noteControlFields(extra);
    if (event === 'Note' && !body && !hasNoteControl(fields)) return null;
    const applied = extra?.appliedControl;
    return {
        id: crypto.randomUUID(),
        time: formatElapsed(timeSec),
        timeSec,
        event,
        temp: tempC != null && Number.isFinite(tempC) ? formatTemp(tempC, unit) : '',
        tempC: tempC != null && Number.isFinite(tempC) ? tempC : null,
        note: event === 'Note' ? body : note,
        ...fields,
        ...(applied && Object.keys(applied).length > 0 ? { appliedControl: applied } : {}),
    };
};
