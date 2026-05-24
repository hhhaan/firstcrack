import { useRef, useEffect, useCallback, useMemo, useState } from 'react';

import { useRoastingStore } from './status';
import { detectTurningPoints } from '@features/active-roast';
import type { TurningPoint } from '@features/active-roast';

const AUTO_CHARGE_WINDOW = 5;

const AUTO_DROP_DROP_C = 8;
const AUTO_DROP_WINDOW = 5;
const AUTO_DROP_MIN_ELAPSED_S = 180;

export const useAutoDetection = (
    livePoints: { time: number; bt: number }[],
    onAutoCharge: (bt: number) => void,
    onAutoDrop: () => void,
    onTurningPoint: (tp: TurningPoint) => void,
    autoChargeDropC: number = 5,
) => {
    const btWindowRef = useRef<number[]>([]);
    const dropWindowRef = useRef<number[]>([]);
    const autoChargedRef = useRef(false);
    const autoDroppedRef = useRef(false);
    const tpFiredRef = useRef(false);

    const [confirmedTP, setConfirmedTP] = useState<TurningPoint | null>(null);

    const phase = useRoastingStore((s) => s.phase);
    const elapsed = useRoastingStore((s) => s.elapsed);
    const liveData = useRoastingStore((s) => s.liveData);
    const bt = liveData?.bt ?? null;

    // Auto Charge
    useEffect(() => {
        if (phase !== 'standby' || bt == null || autoChargedRef.current) return;

        btWindowRef.current = [...btWindowRef.current.slice(-(AUTO_CHARGE_WINDOW - 1)), bt];

        if (btWindowRef.current.length >= AUTO_CHARGE_WINDOW) {
            const first = btWindowRef.current[0];
            const last = btWindowRef.current[btWindowRef.current.length - 1];
            if (first - last >= autoChargeDropC) {
                autoChargedRef.current = true;
                onAutoCharge(bt);
            }
        }
    }, [phase, bt, onAutoCharge]);

    // Auto Drop
    useEffect(() => {
        if (phase !== 'roasting' || bt == null || autoDroppedRef.current) return;
        if (elapsed < AUTO_DROP_MIN_ELAPSED_S) return;

        dropWindowRef.current = [...dropWindowRef.current.slice(-(AUTO_DROP_WINDOW - 1)), bt];

        if (dropWindowRef.current.length >= AUTO_DROP_WINDOW) {
            const first = dropWindowRef.current[0];
            const last = dropWindowRef.current[dropWindowRef.current.length - 1];
            if (first - last >= AUTO_DROP_DROP_C) {
                autoDroppedRef.current = true;
                onAutoDrop();
            }
        }
    }, [phase, bt, elapsed, onAutoDrop]);

    // Turning Point detection
    const detectedTPs = useMemo(() => {
        if (phase !== 'roasting' || livePoints.length < 15) return [];
        return detectTurningPoints(
            livePoints.map((p) => p.time),
            livePoints.map((p) => p.bt),
        );
    }, [phase, livePoints]);

    // Lock in confirmedTP on first detection (no setState in useMemo)
    useEffect(() => {
        if (confirmedTP !== null || detectedTPs.length === 0) return;
        setConfirmedTP(detectedTPs[0]);
    }, [detectedTPs, confirmedTP]);

    // Fire callback exactly once
    useEffect(() => {
        if (confirmedTP === null || tpFiredRef.current) return;
        tpFiredRef.current = true;
        onTurningPoint(confirmedTP);
    }, [confirmedTP, onTurningPoint]);

    const turningPoints = confirmedTP !== null ? [confirmedTP] : detectedTPs;

    // Manual charge를 누를 때 호출해 auto-charge race 방지
    const disableAutoCharge = useCallback(() => {
        autoChargedRef.current = true;
    }, []);

    const resetAutoDetection = useCallback(() => {
        btWindowRef.current = [];
        dropWindowRef.current = [];
        autoChargedRef.current = false;
        autoDroppedRef.current = false;
        tpFiredRef.current = false;
        setConfirmedTP(null);
    }, []);

    return {
        resetAutoDetection,
        disableAutoCharge,
        turningPoints,
        confirmedTP,
    };
};
