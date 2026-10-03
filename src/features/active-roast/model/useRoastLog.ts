import { formatElapsed } from '@shared/lib/format';
import type { LogEntry, RoastNoteControls } from '@shared/types/roast';
import { type SetStateAction, useCallback, useState } from 'react';
import { TOGGLEABLE_LOG_EVENTS } from '../lib/constants';
import { cycleFcDualEntries, FC_END_EVENT, FC_START_EVENT, withoutLogEvent } from '../lib/fc-dual-mark';
import { logEntryTimeSec } from '../lib/serialize-roast-events';
import { formatTemp } from '../lib/temperature';
import type { TemperatureUnit } from './settings';
import { useRoastingStore } from './status';

export const useRoastLog = (unit: TemperatureUnit, rawBT: number | null, elapsed: number) => {
    const logState = useRoastingStore((s) => s.logState);
    const setLogState = useRoastingStore((s) => s.setLogState);
    const logEntries = logState.entries;
    const fcDualUnwind = logState.unwind;
    const [pressedButtons, setPressedButtons] = useState<Set<string>>(new Set());

    const setLogEntries = useCallback(
        (action: SetStateAction<LogEntry[]>) => {
            setLogState((prev) => {
                const entries = typeof action === 'function' ? action(prev.entries) : action;
                return entries === prev.entries ? prev : { entries, unwind: prev.unwind };
            });
        },
        [setLogState],
    );

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
        (
            event: string,
            note: string,
            buttonLabel?: string,
            historical?: { timeSec: number; tempC: number | null },
            controls?: RoastNoteControls,
        ) => {
            const body = note.trim();
            const gas = event === 'Note' ? controls?.gas?.trim() : undefined;
            const airflow = event === 'Note' ? controls?.airflow?.trim() : undefined;
            if (event === 'Note' && !body && !gas && !airflow) return;
            if (event === FC_END_EVENT && !logEntries.some((e) => e.event === FC_START_EVENT)) return;
            if (
                historical &&
                (!Number.isFinite(historical.timeSec) ||
                    (historical.tempC !== null && !Number.isFinite(historical.tempC)) ||
                    !Number.isFinite(elapsed) ||
                    elapsed < 0)
            )
                return;

            const isRemoval = TOGGLEABLE_LOG_EVENTS.has(event) && logEntries.some((e) => e.event === event);
            const rounded = historical ? Math.max(Math.round(historical.timeSec), 0) : elapsed;
            // Notes can be placed ahead of the live curve. Other events stay at or before now.
            const timeSec = historical && event !== 'Note' ? Math.min(rounded, Math.floor(elapsed)) : rounded;
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
                    ...(gas ? { gas } : {}),
                    ...(airflow ? { airflow } : {}),
                };

                return [...prev, newEntry].sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));
            });

            if (!isRemoval && buttonLabel) {
                flashButton(buttonLabel);
            }
        },
        [logEntries, elapsed, rawBT, unit, flashButton, setLogEntries],
    );

    /** Dual-mark: Start → Rolling → unmark Rolling → unmark Start. */
    // ponytail: 플래시 없음 — 버튼이 stage로 즉시 스타일이 바뀌어 피드백이 이미 보인다
    const cycleFc = useCallback(() => {
        setLogState((prev) => cycleFcDualEntries(prev.entries, { elapsed, rawBT, unit }, prev.unwind));
    }, [elapsed, rawBT, unit, setLogState]);

    const handleDrop = useCallback(() => {
        markEvent('Drop', 'Coffee dropped', 'Drop');
    }, [markEvent]);

    const removeLogEntry = useCallback(
        (id: string) => {
            setLogEntries((prev) => prev.filter((entry) => entry.id !== id));
        },
        [setLogEntries],
    );

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
