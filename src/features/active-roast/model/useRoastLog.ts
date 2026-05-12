import { useState, useCallback } from 'react';
import { TOGGLEABLE_LOG_EVENTS } from '../lib/constants';
import { formatTemp } from '../lib/temperature';
import type { TemperatureUnit } from './settings';
import type { LogEntry } from '@shared/types/roast';

export const useRoastLog = (unit: TemperatureUnit, rawBT: number | null, timeStr: string) => {
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

            setLogEntries((prev) => {
                if (TOGGLEABLE_LOG_EVENTS.has(event) && prev.some((e) => e.event === event)) {
                    return prev.filter((e) => e.event !== event);
                }

                const newEntry: LogEntry = {
                    time: timeStr,
                    event,
                    temp: rawBT !== null ? formatTemp(rawBT, unit) : '',
                    note,
                };

                return [...prev, newEntry].sort((a, b) => parseTimeSec(a.time) - parseTimeSec(b.time));
            });

            if (!isRemoval && buttonLabel) {
                flashButton(buttonLabel);
            }
        },
        [logEntries, timeStr, rawBT, unit, flashButton],
    );

    const handleDrop = useCallback(() => {
        markEvent('Drop', 'Coffee dropped', 'Drop');
    }, [markEvent]);

    return {
        logEntries,
        pressedButtons,
        markEvent,
        flashButton,
        handleDrop,
        setLogEntries, // reset할 때 필요
    };
};

const parseTimeSec = (t: string): number => {
    const [m, s] = t.split(':').map(Number);
    return (m || 0) * 60 + (s || 0);
};
