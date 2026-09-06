import type { LogEntry } from '@shared/types/roast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectChargeOnset } from '../lib/chargeOnset';
import { toDisplayTemp } from '../lib/temperature';
import { detectTurningPoints, type TurningPoint } from '../lib/turningPoints';
import type { TemperatureUnit } from './settings';
import { useRoastingStore } from './status';

// 낙차 윈도우는 시간 기준 — 샘플 수 기준이면 pollIntervalMs(500|1000) 설정에 따라 민감도가 2배 달라진다
const AUTO_WINDOW_S = 2.5; // ≈기존 500ms×5샘플 span(2.0s) 수준
const AUTO_WINDOW_MIN_SPAN_S = 2; // 윈도우가 이만큼 차기 전엔 판정 안 함

const AUTO_DROP_MIN_ELAPSED_S = 180;

// TP 미확정이 이 시간을 넘으면 현재 시점을 TP로 강제 확정해 Yellow/FC 게이트를 연다
// (Artisan TP_max_roasttime 동일 — 에어로스터 등 TP 골짜기가 없는 머신 대응)
const TP_FALLBACK_S = 120;

type TimedSample = { t: number; bt: number };

/** 최근 AUTO_WINDOW_S초 슬라이딩 윈도우 갱신 후, 윈도우 내 낙차가 dropC 이상이면 true */
const slideAndCheckDrop = (ref: { current: TimedSample[] }, bt: number, dropC: number): boolean => {
    const now = Date.now() / 1000;
    const w = [...ref.current, { t: now, bt }].filter((p) => now - p.t <= AUTO_WINDOW_S);
    ref.current = w;
    return now - w[0].t >= AUTO_WINDOW_MIN_SPAN_S && w[0].bt - bt >= dropC;
};

export type AutoDropOnset = { timeSec: number; bt: number };

export type UseAutoDetectionOptions = {
    livePoints: { time: number; bt: number }[];
    onAutoCharge: (bt: number, chargeTimeMs?: number) => void;
    onAutoDrop: (onset?: AutoDropOnset) => void;
    onTurningPoint: (tp: TurningPoint) => void;
    autoChargeDropC: number;
    autoDropDropC: number;
    yellowTempC: number;
    unit: TemperatureUnit;
    markEvent?: (event: string, note: string) => void;
    logEntries: LogEntry[];
    autoYellowEnabled: boolean;
};

export const useAutoDetection = ({
    livePoints,
    onAutoCharge,
    onAutoDrop,
    onTurningPoint,
    autoChargeDropC,
    autoDropDropC,
    yellowTempC,
    unit,
    markEvent,
    logEntries,
    autoYellowEnabled,
}: UseAutoDetectionOptions) => {
    const btWindowRef = useRef<TimedSample[]>([]);
    const dropWindowRef = useRef<TimedSample[]>([]);
    const autoChargedRef = useRef(false);
    const autoDroppedRef = useRef(false);
    // 발화 완료 TP를 그대로 보관 — 폴백→실감지 승격 시 재발화 판정에 identity 비교
    const tpFiredRef = useRef<TurningPoint | null>(null);
    const yellowFiredRef = useRef(false);
    const yellowPendingRef = useRef(false);
    const prevDisplayBTRef = useRef<number | null>(null);
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

        if (slideAndCheckDrop(btWindowRef, bt, autoChargeDropC)) {
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
    }, [phase, bt, onAutoCharge, autoChargeDropC]);

    // Auto Drop — 윈도우 낙차 트리거 후 livePoints lookback으로 onset 후처리 (Charge와 동일 알고리즘)
    useEffect(() => {
        if (phase !== 'roasting' || bt == null || autoDroppedRef.current) return;
        if (elapsed < AUTO_DROP_MIN_ELAPSED_S) return;

        if (slideAndCheckDrop(dropWindowRef, bt, autoDropDropC)) {
            autoDroppedRef.current = true;
            const series = livePointsRef.current.filter((p) => p.time >= 0).map((p) => ({ timeSec: p.time, bt: p.bt }));
            if (series.length === 0 || series[series.length - 1].bt !== bt) {
                const t = series.length > 0 ? series[series.length - 1].timeSec + 0.5 : elapsed;
                series.push({ timeSec: t, bt });
            }
            const onset = detectChargeOnset(series, {
                minDropC: Math.max(2, autoDropDropC * 0.4),
            });
            onAutoDrop(
                onset != null ? { timeSec: Math.max(0, onset.timeSec), bt: onset.bt } : { timeSec: elapsed, bt },
            );
        }
    }, [phase, bt, elapsed, onAutoDrop, autoDropDropC]);

    // Auto Yellow by temperature — only fire after turning point (FC is manual / dual-mark only)
    useEffect(() => {
        if (phase !== 'roasting' || bt == null || !markEvent) return;
        if (logEntries.some((e) => e.event === 'Drop' || e.event === 'End')) return;

        // 상승 크로싱만 발화: 레벨 비교(≥)는 뜨거운 드럼 투입 직후 하강 중에도
        // 임계 이상이라 TP 게이트가 열리는 순간 Yellow가 즉시 오발된다.
        // 크로싱은 게이트와 무관하게 상시 추적(pending 래치) — TP 확정 직전에 일어난
        // 크로싱이 유실되면 Yellow가 그 로스팅 내내 침묵한다. 하강으로 임계 아래로
        // 되돌아가면 래치 해제(노이즈 업크로스가 골짜기 이전에 잔류하는 것 방지)
        const displayBT = toDisplayTemp(bt, unit);
        const prev = prevDisplayBTRef.current;
        prevDisplayBTRef.current = displayBT;
        if (prev == null) return;
        const th = toDisplayTemp(yellowTempC, unit);
        if (prev < th && displayBT >= th) yellowPendingRef.current = true;
        else if (displayBT < th) yellowPendingRef.current = false;

        if (!tpFiredRef.current) return;
        if (
            autoYellowEnabled &&
            !yellowFiredRef.current &&
            yellowPendingRef.current &&
            !logEntries.some((e) => e.event === 'Yellow')
        ) {
            yellowFiredRef.current = true;
            markEvent('Yellow', 'Auto-marked by temperature');
        }
    }, [phase, bt, unit, yellowTempC, markEvent, logEntries, autoYellowEnabled]);

    // Turning Point detection — 샘플 수 게이트 없음: 시간 기준 floor는 detectTurningPoints가 소유
    const detectedTPs = useMemo(() => {
        // 실TP 확정 후에는 결과가 쓰이지 않는다 — 매 폴링 tick마다 전체 시리즈 재탐색하는 낭비 차단.
        // 폴백 확정은 잠정치이므로 탐색을 계속한다 (진짜 골짜기가 폴백 시각보다 뒤에 올 수 있음)
        if (phase !== 'roasting' || (confirmedTP !== null && !confirmedTP.fallback)) return [];
        return detectTurningPoints(
            livePoints.map((p) => p.time),
            livePoints.map((p) => p.bt),
        );
    }, [phase, livePoints, confirmedTP]);

    // Lock in confirmedTP on first detection (no setState in useMemo).
    // 폴백으로 확정된 잠정 TP는 실감지가 오면 승격 교체 — 실TP는 한 번 확정되면 불변
    useEffect(() => {
        if (detectedTPs.length === 0) return;
        if (confirmedTP !== null && !confirmedTP.fallback) return;
        setConfirmedTP(detectedTPs[0]);
    }, [detectedTPs, confirmedTP]);

    // TP 타임아웃 폴백 — 미탐 시 Yellow 자동마킹이 조용히 죽는 것 방지.
    // detectedTPs 가드: 같은 tick에 실감지가 있으면 lock-in effect에 양보 (폴백이 덮어쓰기 방지)
    useEffect(() => {
        if (phase !== 'roasting' || confirmedTP !== null || bt == null) return;
        if (elapsed < TP_FALLBACK_S || detectedTPs.length > 0) return;
        setConfirmedTP({ timeSec: elapsed, temp: bt, fallback: true });
    }, [phase, elapsed, bt, confirmedTP, detectedTPs]);

    // Fire callback once per confirmed TP (폴백 → 실감지 승격 시 한 번 더)
    useEffect(() => {
        if (confirmedTP === null || tpFiredRef.current === confirmedTP) return;
        tpFiredRef.current = confirmedTP;
        onTurningPoint(confirmedTP);
    }, [confirmedTP, onTurningPoint]);

    const turningPoints = confirmedTP !== null ? [confirmedTP] : detectedTPs;

    // Manual charge를 누를 때 호출해 auto-charge race 방지
    const disableAutoCharge = useCallback(() => {
        autoChargedRef.current = true;
    }, []);

    /** Connection check 실패 등으로 charge를 안 했을 때 auto-charge 재무장 (#174) */
    const rearmAutoCharge = useCallback(() => {
        autoChargedRef.current = false;
    }, []);

    const resetAutoDetection = useCallback(() => {
        btWindowRef.current = [];
        dropWindowRef.current = [];
        autoChargedRef.current = false;
        autoDroppedRef.current = false;
        tpFiredRef.current = null;
        yellowFiredRef.current = false;
        yellowPendingRef.current = false;
        prevDisplayBTRef.current = null;
        setConfirmedTP(null);
    }, []);

    return {
        resetAutoDetection,
        disableAutoCharge,
        rearmAutoCharge,
        turningPoints,
        confirmedTP,
    };
};
