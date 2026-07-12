import { formatElapsed } from '@shared/lib/format';
import { sidecar } from '@shared/lib/sidecar';
import type { LogEntry } from '@shared/types/roast';
import { useCallback } from 'react';
import { logEntryTimeSec } from '../lib/serialize-roast-events';
import { formatTemp } from '../lib/temperature';
import type { TurningPoint } from '../lib/turningPoints';
import type { TemperatureUnit } from './settings';
import { useRoastingStore } from './status';

interface UseRoastActionsParams {
    unit: TemperatureUnit;
    rawBT: number | null;
    setLogEntries: React.Dispatch<React.SetStateAction<LogEntry[]>>;
    setIsRunning: React.Dispatch<React.SetStateAction<boolean>>;
    setShowEndRoastModal: () => void;
    storeStartCharge: () => void;
    roastStartTimeRef: React.MutableRefObject<number>;
}

interface UseRoastActionsReturn {
    /** chargeTimeMs: auto-charge 후처리 onset 시각. 없으면 Date.now() (manual). */
    triggerCharge: (btAtCharge?: number | null, chargeTimeMs?: number) => void;
    /** onset: auto-drop lookback 결과. 없으면 현재 elapsed/BT. */
    handleAutoDrop: (onset?: { timeSec: number; bt: number }) => void;
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
        (btAtCharge?: number | null, chargeTimeMs?: number) => {
            sidecar.startRoast().catch(() => {});
            const now = Date.now();
            const origin = chargeTimeMs != null && chargeTimeMs <= now ? chargeTimeMs : now;
            roastStartTimeRef.current = origin;
            storeStartCharge();
            // onset이 과거면 elapsed를 lag만큼 시드 (차트 t=0과 타이머 정합)
            if (origin < now) {
                useRoastingStore.setState({ elapsed: Math.floor((now - origin) / 1000) });
            }
            setIsRunning(true);
            const btVal = btAtCharge ?? rawBT;
            setLogEntries([
                {
                    id: crypto.randomUUID(),
                    time: '0:00',
                    timeSec: 0,
                    event: 'Charge',
                    temp: formatTemp(btVal, unit),
                    tempC: btVal,
                    note: 'Bean drop detected',
                },
            ]);
        },
        [unit, rawBT, setLogEntries, setIsRunning, storeStartCharge, roastStartTimeRef],
    );

    const handleAutoDrop = useCallback(
        (onset?: { timeSec: number; bt: number }) => {
            setLogEntries((prev) => {
                if (prev.some((e) => e.event === 'Drop')) return prev;
                const timeSec = Math.max(0, onset?.timeSec ?? useRoastingStore.getState().elapsed);
                const btVal = onset?.bt ?? rawBT;
                return [
                    ...prev,
                    {
                        id: crypto.randomUUID(),
                        time: formatElapsed(timeSec),
                        timeSec,
                        event: 'Drop',
                        temp: formatTemp(btVal, unit),
                        tempC: btVal,
                        note: 'Bean drop detected',
                    },
                ].sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));
            });
            setShowEndRoastModal();
        },
        [rawBT, unit, setLogEntries, setShowEndRoastModal],
    );

    const handleTurningPoint = useCallback(
        (tp: TurningPoint) => {
            setLogEntries((prev) => {
                if (prev.some((e) => e.event === 'TP')) return prev;
                const newEntry: LogEntry = {
                    id: crypto.randomUUID(),
                    time: formatElapsed(tp.timeSec),
                    timeSec: tp.timeSec,
                    event: 'TP',
                    temp: formatTemp(tp.temp, unit),
                    tempC: tp.temp,
                    note: 'Turning Point detected',
                };
                return [...prev, newEntry].sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));
            });
        },
        [unit, setLogEntries],
    );

    return { triggerCharge, handleAutoDrop, handleTurningPoint };
};
