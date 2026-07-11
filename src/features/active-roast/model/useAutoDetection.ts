import type { TurningPoint } from '@features/active-roast';
import { detectTurningPoints } from '@features/active-roast';
import type { LogEntry } from '@shared/types/roast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectChargeOnset } from '../lib/chargeOnset';
import { toDisplayTemp } from '../lib/temperature';
import type { TemperatureUnit } from './settings';
import { useRoastingStore } from './status';

const AUTO_CHARGE_WINDOW = 5;

const AUTO_DROP_DROP_C = 8;
const AUTO_DROP_WINDOW = 5;
const AUTO_DROP_MIN_ELAPSED_S = 180;

export type AutoDropOnset = { timeSec: number; bt: number };

export const useAutoDetection = (
    livePoints: { time: number; bt: number }[],
    onAutoCharge: (bt: number, chargeTimeMs?: number) => void,
    onAutoDrop: (onset?: AutoDropOnset) => void,
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
    // livePoints는 effect 클로저 최신값 필요 — ref로 동기화
    const livePointsRef = useRef(livePoints);
    useEffect(() => {
        livePointsRef.current = livePoints;
    }, [livePoints]);

    const [confirmedTP, setConfirmedTP] = useState<TurningPoint | null>(null);

    const phase = useRoastingStore((s) => s.phase);
    const elapsed = useRoastingStore((s) => s.elapsed);
    const liveData = useRoastingStore((s) => s.liveData);
    const bt = liveData?.bt ?? null;

    // Auto Charge — 윈도우 낙차 트리거 후 livePoints lookback으로 onset 후처리
    useEffect(() => {
        if (phase !== 'standby' || bt == null || autoChargedRef.current) return;

        btWindowRef.current = [...btWindowRef.current.slice(-(AUTO_CHARGE_WINDOW - 1)), bt];

        if (btWindowRef.current.length >= AUTO_CHARGE_WINDOW) {
            const first = btWindowRef.current[0];
            const last = btWindowRef.current[btWindowRef.current.length - 1];
            if (first - last >= autoChargeDropC) {
                autoChargedRef.current = true;
                const series = livePointsRef.current.map((p) => ({ timeSec: p.time, bt: p.bt }));
                // 폴링 포인트에 현재 bt가 아직 없을 수 있어 끝점 보강
                if (series.length === 0 || series[series.length - 1].bt !== bt) {
                    const t = series.length > 0 ? series[series.length - 1].timeSec + 0.5 : 0;
                    series.push({ timeSec: t, bt });
                }
                const onset = detectChargeOnset(series, {
                    minDropC: Math.max(2, autoChargeDropC * 0.4),
                });
                const lastT = series[series.length - 1].timeSec;
                const lagSec = onset != null ? Math.max(0, lastT - onset.timeSec) : 0;
                const chargeTimeMs = Date.now() - lagSec * 1000;
                onAutoCharge(onset?.bt ?? bt, chargeTimeMs);
            }
        }
    }, [phase, bt, onAutoCharge, autoChargeDropC]);

    // Auto Drop — 윈도우 낙차 트리거 후 livePoints lookback으로 onset 후처리 (Charge와 동일 알고리즘)
    useEffect(() => {
        if (phase !== 'roasting' || bt == null || autoDroppedRef.current) return;
        if (elapsed < AUTO_DROP_MIN_ELAPSED_S) return;

        dropWindowRef.current = [...dropWindowRef.current.slice(-(AUTO_DROP_WINDOW - 1)), bt];

        if (dropWindowRef.current.length >= AUTO_DROP_WINDOW) {
            const first = dropWindowRef.current[0];
            const last = dropWindowRef.current[dropWindowRef.current.length - 1];
            if (first - last >= AUTO_DROP_DROP_C) {
                autoDroppedRef.current = true;
                const series = livePointsRef.current
                    .filter((p) => p.time >= 0)
                    .map((p) => ({ timeSec: p.time, bt: p.bt }));
                if (series.length === 0 || series[series.length - 1].bt !== bt) {
                    const t = series.length > 0 ? series[series.length - 1].timeSec + 0.5 : elapsed;
                    series.push({ timeSec: t, bt });
                }
                const onset = detectChargeOnset(series, {
                    minDropC: Math.max(2, AUTO_DROP_DROP_C * 0.4),
                });
                onAutoDrop(
                    onset != null ? { timeSec: Math.max(0, onset.timeSec), bt: onset.bt } : { timeSec: elapsed, bt },
                );
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
