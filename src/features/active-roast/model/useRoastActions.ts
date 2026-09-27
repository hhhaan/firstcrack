import { useActiveWorkspace } from '@entities/organization';
import { formatElapsed } from '@shared/lib/format';
import { logger } from '@shared/lib/logger';
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
    onDrop: (onset?: { timeSec: number; bt: number }) => void;
    storeStartCharge: (originMs?: number, ownerId?: string) => void;
    roastStartTimeRef: React.MutableRefObject<number>;
}

interface UseRoastActionsReturn {
    /** chargeTimeMs: auto-charge 후처리 onset 시각. 없으면 Date.now() (manual). */
    triggerCharge: (btAtCharge?: number | null, chargeTimeMs?: number) => void;
    /** onset: BTbreak 꺾임 점. 없으면 현재 elapsed/BT. */
    handleAutoDrop: (onset?: { timeSec: number; bt: number }) => void;
    handleTurningPoint: (tp: TurningPoint) => void;
}

export const useRoastActions = ({
    unit,
    rawBT,
    setLogEntries,
    setIsRunning,
    onDrop,
    storeStartCharge,
    roastStartTimeRef,
}: UseRoastActionsParams): UseRoastActionsReturn => {
    const { workspaceOwnerId } = useActiveWorkspace();
    const triggerCharge = useCallback(
        (btAtCharge?: number | null, chargeTimeMs?: number) => {
            // manual↔auto 이중 발화 차단 — 어느 쪽이든 선착이 이긴다 (#174)
            if (useRoastingStore.getState().charged) return;
            sidecar.startRoast().catch((error) => {
                logger.capture(new Error('Roast start command failed'), { reason: String(error) });
            });
            const now = Date.now();
            const origin = chargeTimeMs != null && chargeTimeMs <= now ? chargeTimeMs : now;
            // Same origin for livePoints.time (ref) and elapsed (store roastStartMs)
            roastStartTimeRef.current = origin;
            storeStartCharge(origin, workspaceOwnerId);
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
        [unit, rawBT, setLogEntries, setIsRunning, storeStartCharge, roastStartTimeRef, workspaceOwnerId],
    );

    const handleAutoDrop = useCallback(
        (onset?: { timeSec: number; bt: number }) => {
            // Same Drop→end transition as manual Drop. PID/Replay stop via heatHoldAfterDrop.
            onDrop(onset);
        },
        [onDrop],
    );

    const handleTurningPoint = useCallback(
        (tp: TurningPoint) => {
            setLogEntries((prev) => {
                const idx = prev.findIndex((e) => e.event === 'TP');
                // 폴백은 잠정치 — 기존 항목을 덮지 않고, 실감지만 승격 교체한다
                if (idx !== -1 && tp.fallback) return prev;
                const newEntry: LogEntry = {
                    id: idx === -1 ? crypto.randomUUID() : prev[idx].id,
                    time: formatElapsed(tp.timeSec),
                    timeSec: tp.timeSec,
                    event: 'TP',
                    temp: formatTemp(tp.temp, unit),
                    tempC: tp.temp,
                    note: tp.fallback ? 'Turning Point (fallback timeout)' : 'Turning Point detected',
                };
                const next = idx === -1 ? [...prev, newEntry] : prev.map((e, i) => (i === idx ? newEntry : e));
                return next.sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));
            });
        },
        [unit, setLogEntries],
    );

    return { triggerCharge, handleAutoDrop, handleTurningPoint };
};
