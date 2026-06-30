import type { TurningPoint } from '@features/active-roast';
import { detectTurningPoints } from '@features/active-roast';
import type { LogEntry } from '@shared/types/roast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toDisplayTemp } from '../lib/temperature';
import type { TemperatureUnit } from './settings';
import { useRoastingStore } from './status';

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
    yellowTempC: number = 150,
    fcStartTempC: number = 200,
    unit: TemperatureUnit = 'C',
    markEvent?: (event: string, note: string) => void,
    logEntries: LogEntry[] = [],
) => {
    const btWindowRef = useRef<number[]>([]);
    const dropWindowRef = useRef<number[]>([]);
    const autoChargedRef = useRef(false);
    const autoDroppedRef = useRef(false);
    const tpFiredRef = useRef(false);
    const yellowFiredRef = useRef(false);
    const fcStartFiredRef = useRef(false);

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
    }, [phase, bt, onAutoCharge, autoChargeDropC]);

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

    // Auto Yellow / FC Start by temperature — only fire after turning point
    useEffect(() => {
        if (phase !== 'roasting' || bt == null || !markEvent) return;
        if (logEntries.some((e) => e.event === 'Drop' || e.event === 'End')) return;
        if (!tpFiredRef.current) return;

        const displayBT = toDisplayTemp(bt, unit);
        if (
            !yellowFiredRef.current &&
            !logEntries.some((e) => e.event === 'Yellow') &&
            displayBT >= toDisplayTemp(yellowTempC, unit)
        ) {
            yellowFiredRef.current = true;
            markEvent('Yellow', 'Auto-marked by temperature');
        }
        if (
            !fcStartFiredRef.current &&
            !logEntries.some((e) => e.event === 'FC Start') &&
            displayBT >= toDisplayTemp(fcStartTempC, unit)
        ) {
            fcStartFiredRef.current = true;
            markEvent('FC Start', 'Auto-marked by temperature');
        }
    }, [phase, bt, unit, yellowTempC, fcStartTempC, markEvent, logEntries]);

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
        yellowFiredRef.current = false;
        fcStartFiredRef.current = false;
        setConfirmedTP(null);
    }, []);

    return {
        resetAutoDetection,
        disableAutoCharge,
        turningPoints,
        confirmedTP,
    };
};
