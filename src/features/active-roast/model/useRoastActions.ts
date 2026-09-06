import { sidecar } from '@shared/lib/sidecar';
import { useCallback } from 'react';
import type { TurningPoint } from '../lib/turningPoints';
import { useRoastingStore } from './status';

interface UseRoastActionsParams {
    rawBT: number | null;
    markCharge: (bt: number | null) => void;
    markAutoDrop: (onset?: { timeSec: number; bt: number | null }) => void;
    markTurningPoint: (tp: TurningPoint) => void;
    setIsRunning: React.Dispatch<React.SetStateAction<boolean>>;
    setShowEndRoastModal: () => void;
    storeStartCharge: (originMs?: number) => void;
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
    rawBT,
    markCharge,
    markAutoDrop,
    markTurningPoint,
    setIsRunning,
    setShowEndRoastModal,
    storeStartCharge,
    roastStartTimeRef,
}: UseRoastActionsParams): UseRoastActionsReturn => {
    const triggerCharge = useCallback(
        (btAtCharge?: number | null, chargeTimeMs?: number) => {
            // manual↔auto 이중 발화 차단 — 어느 쪽이든 선착이 이긴다 (#174)
            if (useRoastingStore.getState().charged) return;
            sidecar.startRoast().catch(() => {});
            const now = Date.now();
            const origin = chargeTimeMs != null && chargeTimeMs <= now ? chargeTimeMs : now;
            // Same origin for livePoints.time (ref) and elapsed (store roastStartMs)
            roastStartTimeRef.current = origin;
            storeStartCharge(origin);
            setIsRunning(true);
            markCharge(btAtCharge ?? rawBT);
        },
        [rawBT, markCharge, setIsRunning, storeStartCharge, roastStartTimeRef],
    );

    const handleAutoDrop = useCallback(
        (onset?: { timeSec: number; bt: number }) => {
            const timeSec = Math.max(0, onset?.timeSec ?? useRoastingStore.getState().elapsed);
            markAutoDrop({ timeSec, bt: onset?.bt ?? rawBT });
            setShowEndRoastModal();
        },
        [rawBT, markAutoDrop, setShowEndRoastModal],
    );

    const handleTurningPoint = useCallback(
        (tp: TurningPoint) => {
            markTurningPoint(tp);
        },
        [markTurningPoint],
    );

    return { triggerCharge, handleAutoDrop, handleTurningPoint };
};
