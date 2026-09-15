import { formatElapsed } from '@shared/lib/format';
import type { LogEntry } from '@shared/types/roast';
import { useCallback, useRef, useState } from 'react';
import { TOGGLEABLE_LOG_EVENTS } from '../lib/constants';
import { cycleFcDualEntries, withoutLogEvent } from '../lib/fc-dual-mark';
import { logEntryTimeSec } from '../lib/serialize-roast-events';
import { formatTemp } from '../lib/temperature';
import type { TemperatureUnit } from './settings';

export const useRoastLog = (unit: TemperatureUnit, rawBT: number | null, elapsed: number) => {
    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [pressedButtons, setPressedButtons] = useState<Set<string>>(new Set());
    const [fcDualUnwind, setFcDualUnwind] = useState(false);

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
        (event: string, note: string, buttonLabel?: string, historical?: { timeSec: number; tempC: number | null }) => {
            const body = note.trim();
            if (event === 'Note' && !body) return;
            if (
                historical &&
                (!Number.isFinite(historical.timeSec) ||
                    (historical.tempC !== null && !Number.isFinite(historical.tempC)) ||
                    !Number.isFinite(elapsed) ||
                    elapsed < 0)
            )
                return;

            const isRemoval = TOGGLEABLE_LOG_EVENTS.has(event) && logEntries.some((e) => e.event === event);
            const timeSec = historical
                ? Math.min(Math.max(Math.round(historical.timeSec), 0), Math.floor(elapsed))
                : elapsed;
            const tempC = historical ? historical.tempC : rawBT;
            const timeStr = formatElapsed(timeSec);
            const id = crypto.randomUUID();

            setLogEntries((prev) => {
                if (TOGGLEABLE_LOG_EVENTS.has(event) && prev.some((e) => e.event === event)) {
                    return withoutLogEvent(prev, event);
                }

                const newEntry: LogEntry = {
                    id,
                    time: timeStr,
                    timeSec,
                    event,
                    temp: tempC !== null ? formatTemp(tempC, unit) : '',
                    tempC,
                    note: event === 'Note' ? body : note,
                };

                return [...prev, newEntry].sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));
            });

            if (!isRemoval && buttonLabel) {
                flashButton(buttonLabel);
            }
        },
        [logEntries, elapsed, rawBT, unit, flashButton],
    );

    const fcUnwindRef = useRef(false);

    /** Dual-mark: Start → Rolling → unmark Rolling → unmark Start. */
    // ponytail: 플래시 없음 — 버튼이 stage로 즉시 스타일이 바뀌어 피드백이 이미 보인다
    const cycleFc = useCallback(() => {
        setLogEntries((prev) => {
            const { entries, unwind } = cycleFcDualEntries(prev, { elapsed, rawBT, unit }, fcUnwindRef.current);
            fcUnwindRef.current = unwind;
            return entries;
        });
        setFcDualUnwind(fcUnwindRef.current);
    }, [elapsed, rawBT, unit]);

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
        cycleFc,
        fcDualUnwind,
        flashButton,
        handleDrop,
        setLogEntries, // reset할 때 필요
        removeLogEntry,
    };
};
