import { formatElapsed } from '@shared/lib/format';
import type { LogEntry } from '@shared/types/roast';
import { useCallback, useState } from 'react';
import { TOGGLEABLE_LOG_EVENTS } from '../lib/constants';
import { logEntryTimeSec } from '../lib/serialize-roast-events';
import { formatTemp } from '../lib/temperature';
import type { TemperatureUnit } from './settings';

export const useRoastLog = (unit: TemperatureUnit, rawBT: number | null, elapsed: number) => {
    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [pressedButtons, setPressedButtons] = useState<Set<string>>(new Set());

    const flashButton = useCallback((label: string) => {
        setPressedButtons((prev) => new Set(prev).add(label));
        setTimeout(() => {
            setPressedButtons((prev) => {
                const n = new Set(prev);
                n.delete(label);
                return n;
            });
        }, 600);
    }, []);

    const markEvent = useCallback(
        (event: string, note: string, buttonLabel?: string) => {
            const isRemoval = TOGGLEABLE_LOG_EVENTS.has(event) && logEntries.some((e) => e.event === event);
            const timeSec = elapsed;
            const timeStr = formatElapsed(timeSec);

            setLogEntries((prev) => {
                if (TOGGLEABLE_LOG_EVENTS.has(event) && prev.some((e) => e.event === event)) {
                    return prev.filter((e) => e.event !== event);
                }

                const newEntry: LogEntry = {
                    id: crypto.randomUUID(),
                    time: timeStr,
                    timeSec,
                    event,
                    temp: rawBT !== null ? formatTemp(rawBT, unit) : '',
                    tempC: rawBT,
                    note,
                };

                return [...prev, newEntry].sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));
            });

            if (!isRemoval && buttonLabel) {
                flashButton(buttonLabel);
            }
        },
        [logEntries, elapsed, rawBT, unit, flashButton],
    );

    const handleDrop = useCallback(() => {
        markEvent('Drop', 'Coffee dropped', 'Drop');
    }, [markEvent]);

    const removeLogEntry = useCallback((id: string) => {
        setLogEntries((prev) => prev.filter((entry) => entry.id !== id));
    }, []);

    return {
        logEntries,
        pressedButtons,
        markEvent,
        flashButton,
        handleDrop,
        setLogEntries, // reset할 때 필요
        removeLogEntry,
    };
};
