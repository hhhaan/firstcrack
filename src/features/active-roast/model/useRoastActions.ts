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
            const temp = btAtCharge != null ? formatTemp(btAtCharge, unit) : formatTemp(rawBT, unit);
            setLogEntries([{ time: '0:00', event: 'Charge', temp, note: 'Bean drop detected' }]);
        },
        [unit, rawBT, setLogEntries, setIsRunning, storeStartCharge, roastStartTimeRef],
    );

    const handleAutoDrop = useCallback(
        (onset?: { timeSec: number; bt: number }) => {
            setLogEntries((prev) => {
                if (prev.some((e) => e.event === 'Drop')) return prev;
                const timeSec = Math.max(0, Math.floor(onset?.timeSec ?? useRoastingStore.getState().elapsed));
                const min2 = Math.floor(timeSec / 60);
                const sec2 = timeSec % 60;
                const btVal = onset?.bt ?? rawBT;
                return [
                    ...prev,
                    {
                        time: `${min2}:${String(sec2).padStart(2, '0')}`,
                        event: 'Drop',
                        temp: formatTemp(btVal, unit),
                        note: 'Bean drop detected',
                    },
                ].sort((a, b) => parseTimeSec(a.time) - parseTimeSec(b.time));
            });
            setShowEndRoastModal();
        },
        [rawBT, unit, setLogEntries, setShowEndRoastModal],
    );

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
