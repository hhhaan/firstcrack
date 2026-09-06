import type { LogEntry } from '@shared/types/roast';
import { useCallback, useState } from 'react';
import { TOGGLEABLE_LOG_EVENTS } from '../lib/constants';
import type { MarkerDragLivePoint } from '../lib/event-marker-drag';
import { applyEventMarkerDrag } from '../lib/event-marker-drag';
import { cycleFcDualEntries } from '../lib/fc-dual-mark';
import { mark, markDropIfAbsent, replaceWithCharge, resetLog, unmark, upsertTurningPoint } from '../lib/roast-log';
import type { TurningPoint } from '../lib/turningPoints';
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
            setLogEntries((prev) => mark(prev, event, { elapsed, rawBT, unit, note }));
            if (!isRemoval && buttonLabel) {
                flashButton(buttonLabel);
            }
        },
        [logEntries, elapsed, rawBT, unit, flashButton],
    );

    /** Dual-mark cycle: empty → FC Start → FC Rolling → clear both. */
    // ponytail: 플래시 없음 — 버튼이 stage로 즉시 스타일이 바뀌어 피드백이 이미 보인다
    const cycleFc = useCallback(() => {
        setLogEntries((prev) => cycleFcDualEntries(prev, { elapsed, rawBT, unit }));
    }, [elapsed, rawBT, unit]);

    const handleDrop = useCallback(() => {
        markEvent('Drop', 'Coffee dropped', 'Drop');
    }, [markEvent]);

    const removeLogEntry = useCallback((id: string) => {
        setLogEntries((prev) => unmark(prev, id));
    }, []);

    const clearLog = useCallback(() => {
        setLogEntries(resetLog());
    }, []);

    const markCharge = useCallback(
        (bt: number | null) => {
            setLogEntries(replaceWithCharge({ rawBT: bt, unit }));
        },
        [unit],
    );

    const markAutoDrop = useCallback(
        (onset?: { timeSec: number; bt: number | null }) => {
            setLogEntries((prev) =>
                markDropIfAbsent(prev, {
                    timeSec: onset?.timeSec ?? elapsed,
                    bt: onset?.bt ?? rawBT,
                    unit,
                }),
            );
        },
        [elapsed, rawBT, unit],
    );

    const markTurningPoint = useCallback(
        (tp: TurningPoint) => {
            setLogEntries((prev) => upsertTurningPoint(prev, tp, unit));
        },
        [unit],
    );

    const applyMarkerDrag = useCallback(
        (event: string, newTimeSec: number, livePoints: ReadonlyArray<MarkerDragLivePoint>) => {
            setLogEntries((prev) => applyEventMarkerDrag(prev, event, newTimeSec, livePoints, unit));
        },
        [unit],
    );

    return {
        logEntries,
        pressedButtons,
        markEvent,
        cycleFc,
        flashButton,
        handleDrop,
        removeLogEntry,
        clearLog,
        markCharge,
        markAutoDrop,
        markTurningPoint,
        applyMarkerDrag,
    };
};
