import { i18n } from '@shared/i18n';
import { createBtFilter } from '@shared/lib/btFilter';
import { useToastStore } from '@shared/store/toast';
import type { LogEntry } from '@shared/types/roast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    type AutoChargeMode,
    type AutoDropMode,
    createAutoChargeDetector,
    createAutoDropDetector,
    type RawTemperatureSample,
} from '../lib/autoCharge';
import { createMachineAutoDetector, type MachineAutoDecision } from '../lib/machineAutoEvent';
import { detectTurningPoints, type TurningPoint } from '../lib/turningPoints';
import type { PollIntervalMs, TemperatureUnit } from './settings';
import { useRoastingStore } from './status';

// TP 미확정이 이 시간을 넘으면 그 시점의 raw BT로 강제 확정해 Yellow 게이트를 연다
// (Artisan TP_max_roasttime 동일 — 에어로스터 등 TP 골짜기가 없는 머신 대응)
const TP_FALLBACK_S = 120;

type RawSample = { time: number; bt: number };
type RawPoint = {
    time: number;
    btRaw?: number | null;
    sensorTimestamp?: number | null;
    sensorClock?: string | null;
};
const YELLOW_CONFIRM_S = 1;

const noteMachineSample = (
    detector: ReturnType<typeof createMachineAutoDetector>,
    noted: { current: { sample: RawTemperatureSample | null; decision: MachineAutoDecision } | null },
    state: {
        rawTemperature: RawTemperatureSample | null;
        machineSnapshot: { machine_roaster_key: string | null } | null;
        phase: string;
    },
): MachineAutoDecision => {
    const sample = state.rawTemperature;
    if (noted.current?.sample === sample) return noted.current.decision;
    const decision = detector.push({
        roasterKey: state.machineSnapshot?.machine_roaster_key,
        autoStatus: sample?.autoStatus,
        phase: state.phase,
    });
    noted.current = { sample, decision };
    return decision;
};

/**
 * Keep discontinuities as NaN so neither TP nor Yellow bridges missing observations.
 * Sensor clocks prove novelty; older raw recordings use the recording clock.
 */
const acceptedRawSamples = (points: RawPoint[], maxGapSec: number): RawSample[] => {
    let filter = createBtFilter();
    const samples: RawSample[] = [];
    let lastTimestamp: number | null = null;
    let lastTime: number | null = null;
    let lastClock: string | null | undefined;
    for (const point of points) {
        const timestamp = point.sensorTimestamp === undefined ? point.time : point.sensorTimestamp;
        if (
            !Number.isFinite(point.time) ||
            point.btRaw == null ||
            !Number.isFinite(point.btRaw) ||
            timestamp == null ||
            !Number.isFinite(timestamp)
        ) {
            samples.push({ time: point.time, bt: NaN });
            filter = createBtFilter();
            lastTimestamp = null;
            lastTime = null;
            continue;
        }
        const clockChanged = point.sensorClock !== lastClock;
        if (!clockChanged && lastTimestamp !== null && timestamp <= lastTimestamp) continue;
        if (
            clockChanged ||
            (lastTimestamp !== null && timestamp - lastTimestamp > maxGapSec) ||
            (lastTime !== null && point.time - lastTime > maxGapSec)
        ) {
            samples.push({ time: point.time, bt: NaN });
            filter = createBtFilter();
        }
        lastClock = point.sensorClock;
        lastTimestamp = timestamp;
        lastTime = point.time;
        samples.push({ time: point.time, bt: filter(point.btRaw, timestamp * 1000) ?? NaN });
    }
    return samples;
};

/** 마지막 상승 크로싱. 임계 아래로 내려가면 래치를 푼다. */
const latestRisingCross = (samples: RawSample[], thresholdC: number): RawSample | null => {
    let cross: RawSample | null = null;
    let pending: RawSample | null = null;
    for (let i = 1; i < samples.length; i++) {
        const prev = samples[i - 1].bt;
        const cur = samples[i];
        if (!Number.isFinite(cur.bt) || cur.bt < thresholdC) {
            pending = null;
            cross = null;
        } else {
            if (prev < thresholdC) pending = cur;
            if (pending && cur.time - pending.time >= YELLOW_CONFIRM_S) cross = pending;
        }
    }
    return cross;
};

export type AutoDropOnset = { timeSec: number; bt: number };

export type UseAutoDetectionOptions = {
    /** `bt` is the display EMA. TP/Yellow read `btRaw` only. */
    livePoints: (RawPoint & { bt: number })[];
    onAutoCharge: (bt: number, chargeTimeMs?: number) => void;
    onAutoDrop: (onset?: AutoDropOnset) => void;
    onTurningPoint: (tp: TurningPoint) => void;
    autoChargeEnabled: boolean;
    autoChargeMode: AutoChargeMode;
    pollIntervalMs: PollIntervalMs;
    autoDropEnabled: boolean;
    autoDropMode: AutoDropMode;
    /** Fire only once `elapsed` exceeds this many minutes (`elapsed > minutes * 60`). */
    autoDropStartMin: number;
    yellowTempC: number;
    /** Display unit. Auto Yellow compares raw °C to `yellowTempC`; markEvent formats the log. */
    unit: TemperatureUnit;
    markEvent?: (
        event: string,
        note: string,
        buttonLabel?: string,
        historical?: { timeSec: number; tempC: number | null },
    ) => void;
    logEntries: LogEntry[];
    autoYellowEnabled: boolean;
};

export const useAutoDetection = ({
    livePoints,
    onAutoCharge,
    onAutoDrop,
    onTurningPoint,
    autoChargeEnabled,
    autoChargeMode,
    pollIntervalMs,
    autoDropEnabled,
    autoDropMode,
    autoDropStartMin,
    yellowTempC,
    markEvent,
    logEntries,
    autoYellowEnabled,
}: UseAutoDetectionOptions) => {
    const chargeDetectorRef = useRef<ReturnType<typeof createAutoChargeDetector> | null>(null);
    const dropDetectorRef = useRef<ReturnType<typeof createAutoDropDetector> | null>(null);
    const onAutoChargeRef = useRef(onAutoCharge);
    const onAutoDropRef = useRef(onAutoDrop);
    useEffect(() => {
        onAutoChargeRef.current = onAutoCharge;
    }, [onAutoCharge]);
    useEffect(() => {
        onAutoDropRef.current = onAutoDrop;
    }, [onAutoDrop]);
    const autoChargedRef = useRef(false);
    const chargeCooldownRef = useRef<{ minBt: number; lastTimestamp: number; recoverySamples: number } | null>(null);
    const autoDroppedRef = useRef(false);
    const machineAutoRef = useRef(createMachineAutoDetector());
    const machineNotedRef = useRef<{ sample: RawTemperatureSample | null; decision: MachineAutoDecision } | null>(null);
    // 발화 완료 TP를 그대로 보관 — 폴백→실감지 승격 시 재발화 판정에 identity 비교
    const tpFiredRef = useRef<TurningPoint | null>(null);
    const yellowFiredRef = useRef(false);
    const [confirmedTP, setConfirmedTP] = useState<TurningPoint | null>(null);

    const phase = useRoastingStore((s) => s.phase);
    const elapsed = useRoastingStore((s) => s.elapsed);
    const connected = useRoastingStore((s) => s.sidecarConnected);
    const reconnecting = useRoastingStore((s) => s.reconnecting);
    const maxGapSec = (pollIntervalMs / 1000) * 1.5;
    const rawSamples = useMemo(() => acceptedRawSamples(livePoints, maxGapSec), [livePoints, maxGapSec]);
    const latestRaw = rawSamples[rawSamples.length - 1];
    const rawIsFresh =
        connected &&
        !reconnecting &&
        latestRaw != null &&
        Number.isFinite(latestRaw.bt) &&
        elapsed - latestRaw.time <= maxGapSec;
    const yellowCross = useMemo(() => latestRisingCross(rawSamples, yellowTempC), [rawSamples, yellowTempC]);

    // Consume each raw response synchronously, independently of React rendering and display dedupe.
    useEffect(() => {
        const detector = createAutoChargeDetector(autoChargeMode, pollIntervalMs);
        chargeDetectorRef.current = detector;
        const unsubscribe = useRoastingStore.subscribe((state, previous) => {
            const linkChanged =
                state.sidecarConnected !== previous.sidecarConnected ||
                state.reconnecting !== previous.reconnecting ||
                state.machineSnapshot !== previous.machineSnapshot;
            if (linkChanged || state.phase !== previous.phase) detector.reset();
            if (linkChanged) {
                machineAutoRef.current.reset();
                machineNotedRef.current = null;
            }
            const sample = state.rawTemperature;
            const cooldown = chargeCooldownRef.current;
            if (
                cooldown &&
                state.phase === 'standby' &&
                state.sidecarConnected &&
                !state.reconnecting &&
                sample !== previous.rawTemperature &&
                sample &&
                Number.isFinite(sample.bt) &&
                sample.bt > 0 &&
                sample.bt < 400 &&
                Number.isFinite(sample.timestamp) &&
                sample.timestamp > cooldown.lastTimestamp
            ) {
                cooldown.lastTimestamp = sample.timestamp;
                if (sample.bt >= cooldown.minBt + (autoChargeMode === 'sensitive' ? 1 : 2)) {
                    cooldown.recoverySamples++;
                    if (cooldown.recoverySamples >= 2) {
                        chargeCooldownRef.current = null;
                        autoChargedRef.current = false;
                    }
                } else {
                    cooldown.minBt = Math.min(cooldown.minBt, sample.bt);
                    cooldown.recoverySamples = 0;
                }
            }
            if (state.rawTemperature === previous.rawTemperature) return;
            const machine = noteMachineSample(machineAutoRef.current, machineNotedRef, state);
            if (
                machine.event === 'charge' &&
                autoChargeEnabled &&
                state.phase === 'standby' &&
                state.sidecarConnected &&
                !state.reconnecting &&
                !autoChargedRef.current &&
                sample &&
                Number.isFinite(sample.bt)
            ) {
                autoChargedRef.current = true;
                detector.reset();
                onAutoChargeRef.current(sample.bt, sample.receivedAtMs);
                return;
            }
            if (
                !autoChargeEnabled ||
                state.phase !== 'standby' ||
                !state.sidecarConnected ||
                state.reconnecting ||
                autoChargedRef.current ||
                machine.suppressTemperatureCharge
            ) {
                detector.reset();
                return;
            }
            const onset = detector.push(sample);
            if (!sample || !onset) return;
            autoChargedRef.current = true;
            onAutoChargeRef.current(onset.bt, sample.receivedAtMs - (sample.timestamp - onset.timestamp) * 1000);
        });
        return () => {
            unsubscribe();
            detector.reset();
        };
    }, [autoChargeEnabled, autoChargeMode, pollIntervalMs]);

    useEffect(() => {
        if (logEntries.some((e) => e.event === 'Drop')) autoDroppedRef.current = true;
    }, [logEntries]);

    useEffect(() => {
        const detector = createAutoDropDetector(autoDropMode, pollIntervalMs);
        dropDetectorRef.current = detector;
        // Artisan autoDROP: CHARGE 후 N분 초과일 때만 발화. N=autoDropStartMin (default 7).
        const minElapsedS = autoDropStartMin * 60;
        const unsubscribe = useRoastingStore.subscribe((state, previous) => {
            if (
                state.phase !== previous.phase ||
                state.sidecarConnected !== previous.sidecarConnected ||
                state.reconnecting !== previous.reconnecting ||
                state.machineSnapshot !== previous.machineSnapshot
            ) {
                detector.reset();
            }
            if (state.rawTemperature === previous.rawTemperature) return;
            const sample = state.rawTemperature;
            const machine = noteMachineSample(machineAutoRef.current, machineNotedRef, state);
            if (
                machine.event === 'drop' &&
                autoDropEnabled &&
                state.phase === 'roasting' &&
                state.sidecarConnected &&
                !state.reconnecting &&
                !autoDroppedRef.current &&
                sample &&
                Number.isFinite(sample.bt)
            ) {
                autoDroppedRef.current = true;
                detector.reset();
                const start = state.roastStartMs;
                onAutoDropRef.current({
                    timeSec: start > 0 ? Math.max(0, (sample.receivedAtMs - start) / 1000) : state.elapsed,
                    bt: sample.bt,
                });
                return;
            }
            if (
                !autoDropEnabled ||
                state.phase !== 'roasting' ||
                !state.sidecarConnected ||
                state.reconnecting ||
                autoDroppedRef.current ||
                machine.suppressTemperatureDrop
            ) {
                detector.reset();
                return;
            }
            // Samples at or before the start minute must not confirm once the gate opens.
            if (state.elapsed <= minElapsedS) {
                detector.reset();
                return;
            }
            const onset = detector.push(sample);
            if (!sample || !onset) return;
            autoDroppedRef.current = true;
            const lagSec = sample.timestamp - onset.timestamp;
            const onsetWall = sample.receivedAtMs - lagSec * 1000;
            const start = state.roastStartMs;
            onAutoDropRef.current({
                timeSec: start > 0 ? Math.max(0, (onsetWall - start) / 1000) : Math.max(0, state.elapsed - lagSec),
                bt: onset.bt,
            });
        });
        return () => {
            unsubscribe();
            detector.reset();
        };
    }, [autoDropEnabled, autoDropMode, pollIntervalMs, autoDropStartMin]);

    // Auto Yellow — raw 상승 크로싱만, TP 확정 후 한 번 (FC는 수동). 로그 온도는 그 raw 샘플.
    useEffect(() => {
        if (phase !== 'roasting' || !markEvent || !yellowCross || !rawIsFresh) return;
        if (logEntries.some((e) => e.event === 'Drop' || e.event === 'End')) return;
        // 상승 크로싱만 발화: 뜨거운 드럼 투입 직후 하강은 임계 위여도 크로싱이 아니다.
        // 크로싱은 게이트와 무관하게 시리즈에서 유지되고, 임계 아래로 내려가면 풀린다.
        if (!confirmedTP) return;
        if (autoYellowEnabled && !yellowFiredRef.current && !logEntries.some((e) => e.event === 'Yellow')) {
            yellowFiredRef.current = true;
            markEvent('Yellow', 'Auto-marked by temperature', undefined, {
                timeSec: yellowCross.time,
                tempC: yellowCross.bt,
            });
        }
    }, [phase, yellowCross, markEvent, logEntries, autoYellowEnabled, confirmedTP, rawIsFresh]);

    // Turning Point — 필터를 통과한 raw BT. 시간 floor는 detectTurningPoints가 소유
    const detectedTPs = useMemo(() => {
        // 실TP 확정 후에는 결과가 쓰이지 않는다 — 매 폴링 tick마다 전체 시리즈 재탐색하는 낭비 차단.
        // 폴백 확정은 잠정치이므로 탐색을 계속한다 (진짜 골짜기가 폴백 시각보다 뒤에 올 수 있음)
        if (phase !== 'roasting' || !rawIsFresh || (confirmedTP !== null && !confirmedTP.fallback)) return [];
        return detectTurningPoints(
            rawSamples.map((p) => p.time),
            rawSamples.map((p) => p.bt),
            maxGapSec,
        );
    }, [phase, rawSamples, confirmedTP, maxGapSec, rawIsFresh]);

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
        if (phase !== 'roasting' || confirmedTP !== null || !rawIsFresh) return;
        if (elapsed < TP_FALLBACK_S || detectedTPs.length > 0) return;
        if (rawSamples.length === 0) return;
        const latest = rawSamples[rawSamples.length - 1];
        if (!Number.isFinite(latest.bt) || elapsed - latest.time > maxGapSec) return;
        setConfirmedTP({ timeSec: latest.time, temp: latest.bt, fallback: true });
    }, [phase, elapsed, rawSamples, confirmedTP, detectedTPs, maxGapSec, rawIsFresh]);

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
        chargeDetectorRef.current?.reset();
    }, []);

    /** Connection check 실패 등으로 charge를 안 했을 때 auto-charge 재무장 (#174) */
    const rearmAutoCharge = useCallback(() => {
        autoChargedRef.current = chargeCooldownRef.current !== null;
        chargeDetectorRef.current?.reset();
    }, []);

    const holdAutoChargeUntilRecovery = useCallback(() => {
        // ponytail: BT must rebound after Drop; manual Charge covers machines without a rebound.
        chargeCooldownRef.current = { minBt: Infinity, lastTimestamp: -Infinity, recoverySamples: 0 };
        autoChargedRef.current = true;
        chargeDetectorRef.current?.reset();
        if (!autoChargeEnabled) return;
        useToastStore.getState().show(i18n.t('activeRoast.autoChargeHeld'), 'info');
    }, [autoChargeEnabled]);

    const disableAutoDrop = useCallback(() => {
        autoDroppedRef.current = true;
        dropDetectorRef.current?.reset();
    }, []);

    const resetAutoDetection = useCallback(() => {
        chargeDetectorRef.current?.reset();
        dropDetectorRef.current?.reset();
        machineAutoRef.current.reset();
        machineNotedRef.current = null;
        autoChargedRef.current = false;
        chargeCooldownRef.current = null;
        autoDroppedRef.current = false;
        tpFiredRef.current = null;
        yellowFiredRef.current = false;
        setConfirmedTP(null);
    }, []);

    // A dragged TP is a real mark. Later valley detection must not put it back.
    const moveTurningPoint = useCallback((timeSec: number, temp: number) => {
        if (!Number.isFinite(timeSec) || !Number.isFinite(temp)) return;
        setConfirmedTP({ timeSec, temp, fallback: false });
    }, []);

    return {
        resetAutoDetection,
        disableAutoCharge,
        rearmAutoCharge,
        holdAutoChargeUntilRecovery,
        disableAutoDrop,
        moveTurningPoint,
        turningPoints,
        confirmedTP,
    };
};
