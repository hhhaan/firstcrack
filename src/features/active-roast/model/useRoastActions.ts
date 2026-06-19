import { sidecar } from '@shared/lib/sidecar';
import type { LogEntry } from '@shared/types/roast';
import { useCallback } from 'react';
import { formatTemp } from '../lib/temperature';
import { parseTimeSec } from '../lib/time';
import type { TurningPoint } from '../lib/turningPoints';
import type { TemperatureUnit } from './settings';
import { useRoastingStore } from './status';

interface UseRoastActionsParams {
    unit: TemperatureUnit;
    rawBT: number | null;
    setLogEntries: React.Dispatch<React.SetStateAction<LogEntry[]>>;
    setIsRunning: React.Dispatch<React.SetStateAction<boolean>>;
    setShowEndRoastModal: React.Dispatch<React.SetStateAction<boolean>>;
    storeStartCharge: () => void;
    roastStartTimeRef: React.MutableRefObject<number>;
}

interface UseRoastActionsReturn {
    triggerCharge: (btAtCharge?: number | null) => void;
    handleAutoDrop: () => void;
    handleTurningPoint: (tp: TurningPoint) => void;
}

export const useRoastActions = ({
    unit,
    rawBT,
    setLogEntries,
    setIsRunning,
    setShowEndRoastModal,
    storeStartCharge,
    roastStartTimeRef,
}: UseRoastActionsParams): UseRoastActionsReturn => {
    const triggerCharge = useCallback(
        (btAtCharge?: number | null) => {
            sidecar.startRoast().catch(() => {});
            roastStartTimeRef.current = Date.now();
            storeStartCharge();
            setIsRunning(true);
            const temp = btAtCharge != null ? formatTemp(btAtCharge, unit) : formatTemp(rawBT, unit);
            setLogEntries([{ time: '0:00', event: 'Charge', temp, note: 'Bean drop detected' }]);
        },
        [unit, rawBT, setLogEntries, setIsRunning, storeStartCharge, roastStartTimeRef],
    );

    const handleAutoDrop = useCallback(() => {
        setLogEntries((prev) => {
            if (prev.some((e) => e.event === 'Drop')) return prev;
            const elapsed = useRoastingStore.getState().elapsed;
            const min2 = Math.floor(elapsed / 60);
            const sec2 = elapsed % 60;
            return [
                ...prev,
                {
                    time: `${min2}:${String(sec2).padStart(2, '0')}`,
                    event: 'Drop',
                    temp: formatTemp(rawBT, unit),
                    note: 'Bean drop detected',
                },
            ];
        });
        setShowEndRoastModal(true);
    }, [rawBT, unit, setLogEntries, setShowEndRoastModal]);

    const handleTurningPoint = useCallback(
        (tp: TurningPoint) => {
            const timeMin = Math.floor(tp.timeSec / 60);
            const tpSec = Math.floor(tp.timeSec % 60);
            const tpTimeStr = `${timeMin}:${String(tpSec).padStart(2, '0')}`;
            setLogEntries((prev) => {
                if (prev.some((e) => e.event === 'TP')) return prev;
                const newEntry = {
                    time: tpTimeStr,
                    event: 'TP',
                    temp: formatTemp(tp.temp, unit),
                    note: 'Turning Point detected',
                };
                return [...prev, newEntry].sort((a, b) => parseTimeSec(a.time) - parseTimeSec(b.time));
            });
        },
        [unit, setLogEntries],
    );

    return { triggerCharge, handleAutoDrop, handleTurningPoint };
};
