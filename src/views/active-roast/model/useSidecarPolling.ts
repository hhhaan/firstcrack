import { snapshotFromSidecar, useMachines } from '@entities/machine';
import type { RawTemperatureSample } from '@features/active-roast';
import { reduceSensorObservation, sensorObservationTick } from '@features/active-roast/lib/sensorObservation';
import { BBP_INPROGRESS_ID, bbpPointsToTsv, useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import {
    captureLinkEpoch,
    machineTemperatureQuality,
    observeRoastLink,
    setRoastLinkWatch,
} from '@features/machine-connection/lib/machineLinkNotice';
import { createBtFilter } from '@shared/lib/btFilter';
import { errorMessage } from '@shared/lib/errorMessage';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { deleteBbpTsv, enqueueTsvRow, formatRoastTsvRow, initSessionTsv, writeBbpTsv } from '@shared/lib/tsv-writer';
import type { LiveRoastPoint } from '@shared/types/roast';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { classifySidecarConnection } from '../lib/classify-sidecar-connection';
import { shouldAcceptTick } from '../lib/poll-tick-gate';

/** 좀비 사이드카 401. ready가 아니며 연결 끊김으로 승격하지 않는다. */
const isUnauthorizedSidecar = (err: unknown): boolean => errorMessage(err).toLowerCase() === 'unauthorized';

/** 원시 온도는 유한한 값만 보관한다. ET의 -1(채널 없음)도 남긴다. */
const finiteRawTemperature = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

/** 폴링 중 누적하는 실시간 측정 포인트 */
export type { LiveRoastPoint } from '@shared/types/roast';

interface Params {
    /** 뷰가 화면에 노출되어 있는지 여부 (CSS hide → show 전환 감지) */
    isActive: boolean;
    /** 현재 로스팅 단계 */
    phase: string;
    /** 온도 폴링 주기 (ms) */
    pollIntervalMs: number;
    enterPreheating: (capabilities?: string[]) => void;
    setConnected: (connected: boolean, capabilities?: string[]) => void;
    /** Charge 시 생성된 세션 UUID. null이면 미시작 */
    sessionId: string | null;
    /** Charge 로그의 온도 — 자동 감지 시 현재 BT가 아닌 소급 onset BT. */
    chargeBt?: number | null;
}

/** idle 중 /status 재확인 주기 — 온도 폴링보다 느슨 (부하 거의 없음). */
export const IDLE_STATUS_POLL_MS = 5000;

/** Charge lookback 샘플 라벨. relSec < 0일 때만 마이너스 접두. */
export function formatLookbackLabel(relSec: number): string {
    const absT = Math.abs(relSec);
    const m = Math.floor(absT / 60);
    const s = Math.floor(absT % 60);
    const body = `${m}:${String(s).padStart(2, '0')}`;
    return relSec < 0 ? `-${body}` : body;
}

type SidecarStatusLike = {
    connected: boolean;
    reconnecting?: boolean;
    error?: string | null;
    capabilities?: string[];
    roaster?: string | null;
    display_name?: string | null;
    brand?: string | null;
};

/**
 * 연결 상태 확인 후 idle이면 preheating 재진입.
 * preheating/standby 끊김 → idle 이후 뷰 유지 시 자동 복구 (#178).
 * 자동 재연결 중에는 hard disconnect로 내리지 않는다 (세션 리셋 방지).
 */
export async function checkSidecarAndRecoverIdle(deps: {
    getStatus: () => Promise<SidecarStatusLike>;
    getPhase: () => string;
    setConnected: (connected: boolean, capabilities?: string[]) => void;
    enterPreheating: (capabilities?: string[]) => void;
    setReconnecting?: (reconnecting: boolean) => void;
    setError?: (error: string | null) => void;
    onConnectedStatus?: (status: SidecarStatusLike) => void;
    /** Idle status loop owns the notice. Temperature polling reports for every other phase. */
    reportLink?: boolean;
}): Promise<void> {
    const epoch = captureLinkEpoch();
    const report = (connected: boolean, reconnecting: boolean) => {
        if (!deps.reportLink) return;
        observeRoastLink({ connected, reconnecting }, epoch);
    };
    try {
        const s = await deps.getStatus();
        if (s.connected) {
            deps.setReconnecting?.(false);
            deps.setError?.(null);
            deps.setConnected(true, s.capabilities);
            deps.onConnectedStatus?.(s);
            report(true, false);
            if (deps.getPhase() === 'idle') {
                deps.enterPreheating(s.capabilities);
            }
            return;
        }
        const decision = classifySidecarConnection({
            kind: 'null_bt',
            status: s,
            dataReconnecting: s.reconnecting,
        });
        deps.setReconnecting?.(decision.reconnecting);
        deps.setError?.(decision.error);
        deps.setConnected(decision.connected);
        report(decision.connected, decision.reconnecting);
        // reconnecting hold: do not enter preheating from idle until link is solid
    } catch (err) {
        if (isUnauthorizedSidecar(err)) return;
        logger.capture(err, { scope: 'sidecarPolling.status' });
        deps.setReconnecting?.(false);
        deps.setConnected(false);
        report(false, false);
    }
}

/**
 * 사이드카(파이썬 프로세스)와의 연결 상태를 관리하고,
 * 로스팅 중 온도를 주기적으로 폴링해 livePoints 배열을 누적한다.
 *
 * livePoints는 차트·자동감지 훅에서 공유되므로 이 훅에서 소유한다.
 * resetActiveRoast 등 외부에서 초기화가 필요할 때를 위해 setLivePoints도 반환한다.
 *
 * sessionId가 설정되면 AppLocalData/session_{sessionId}.tsv에 커브 데이터를 기록한다.
 */
export const useSidecarPolling = ({
    isActive,
    phase,
    pollIntervalMs,
    enterPreheating,
    setConnected,
    sessionId,
    chargeBt = null,
}: Params) => {
    const livePoints = useRoastingStore((s) => s.livePoints);
    const setLivePoints = useRoastingStore((s) => s.setLivePoints);
    const [sidecarReady, setSidecarReady] = useState(false);
    // standby 첫 폴링 시각 — livePoints 실시간 표시용 세션 기준점
    const preChargeStartRef = useRef<number>(0);
    const lastPreChargeAbsRef = useRef(0);
    const prevPhaseRef = useRef(phase);
    /** Session that owns the roast curve. Kept across Drop; the next Charge replaces it. */
    const curveSessionRef = useRef<string | null>(null);
    // BT 이상치 필터 — 스파이크/0값이 자동감지(charge·TP·FC·drop) 윈도우에 들어가는 것을 차단
    const btFilterRef = useRef<ReturnType<typeof createBtFilter> | null>(null);
    const rawBtFilterRef = useRef<ReturnType<typeof createBtFilter> | null>(null);
    const lastRawTimestampRef = useRef<number | null>(null);
    const pollInFlightRef = useRef(false);
    const sidecarGenerationRef = useRef(0);
    const lastMachineRef = useRef(useRoastingStore.getState().machineSnapshot);

    // sessionId가 새로 설정되면 TSV 파일을 헤더로 초기화한다.
    useEffect(() => {
        if (!sessionId) return;
        void initSessionTsv(sessionId).catch(() => {});
    }, [sessionId]);

    // phase → 'roasting' 전환 감지:
    // BBP finalize + 차트 00:00 (#433). 음수 lookback 없음.
    // Drop 취소는 같은 세션으로 돌아오므로 Charge 시드·BBP finalize를 하지 않는다 (#638).
    useEffect(() => {
        if (prevPhaseRef.current !== 'roasting' && phase === 'roasting') {
            const store = useRoastingStore.getState();
            const sameBatchResume = store.sessionId != null && curveSessionRef.current === store.sessionId;
            if (!sameBatchResume) {
                const { sessionId: bbpSessionId, roastStartMs } = store;
                const chargeTime = roastStartMs;
                const bbpResult = bbpSessionId
                    ? useBbpStore.getState().finalize(chargeTime || Date.now(), bbpSessionId)
                    : null;
                if (bbpResult && bbpSessionId) {
                    void writeBbpTsv(bbpSessionId, bbpResult.tsv)
                        .then(() => deleteBbpTsv(BBP_INPROGRESS_ID))
                        .catch((err) => {
                            logger.capture(err instanceof Error ? err : new Error(String(err)), {
                                context: 'bbp tsv write',
                                sessionId: bbpSessionId,
                            });
                        });
                }
                // 대기 커브는 지우되 Charge 로그와 같은 00:00 시작점은 보존한다 (#452).
                const lastPoint = livePoints.length > 0 ? livePoints[livePoints.length - 1] : null;
                const sample = lastPoint ?? useRoastingStore.getState().liveData;
                const etRaw = lastPoint
                    ? (lastPoint.etRaw ?? null)
                    : (useRoastingStore.getState().liveData?.et_raw ?? null);
                const btRaw = lastPoint
                    ? (lastPoint.btRaw ?? null)
                    : finiteRawTemperature(useRoastingStore.getState().liveData?.bt_raw);
                const seed: LiveRoastPoint | null =
                    chargeBt != null && Number.isFinite(chargeBt)
                        ? {
                              time: 0,
                              label: '0:00',
                              bt: chargeBt,
                              et: sample?.et ?? null,
                              ror: null,
                              ror_et: null,
                              heater: sample?.heater ?? null,
                              fan: sample?.fan ?? 0,
                              drum: sample?.drum ?? 0,
                              heaterSet: lastPoint?.heaterSet ?? null,
                              etRaw,
                              btRaw,
                              sensorTimestamp: null,
                              sensorClock: null,
                              processing: sample?.processing,
                          }
                        : null;
                setLivePoints(seed ? [seed] : []);
                if (seed && bbpSessionId) {
                    enqueueTsvRow(bbpSessionId, formatRoastTsvRow(seed), seed.processing);
                }
                preChargeStartRef.current = 0;
                lastPreChargeAbsRef.current = 0;
            } else {
                // 다음 대기 구간은 0부터. 로스팅 간격은 복원된 커브의 마지막 샘플로 판단한다.
                // 이 렌더의 livePoints는 아직 대기 커브일 수 있어 여기서 덮지 않는다.
                preChargeStartRef.current = 0;
                lastPreChargeAbsRef.current = 0;
            }
        }
        if (phase === 'roasting') {
            const id = useRoastingStore.getState().sessionId;
            if (id) curveSessionRef.current = id;
        }
        prevPhaseRef.current = phase;
    }, [phase, chargeBt, livePoints, setLivePoints]);

    // Rust는 인증된 200 뒤에만 sidecar-ready를 쏜다. 마운트가 그 이벤트보다 늦으면
    // waitUntilReady 폴백이 첫 정상 상태를 대신 확인한다 (Machines와 같은 규칙).
    useEffect(() => {
        if (!isActive) return;
        let cancelled = false;
        let unlisten: (() => void) | undefined;

        const markReady = () => {
            if (cancelled) return;
            setSidecarReady(true);
        };

        void listen<null>('sidecar-ready', () => {
            sidecarGenerationRef.current += 1;
            btFilterRef.current = createBtFilter();
            rawBtFilterRef.current = createBtFilter();
            lastRawTimestampRef.current = null;
            const store = useRoastingStore.getState();
            store.updateRawTemperature(null);
            store.updateSensorObservation(null);
            void sidecar.waitUntilReady().then(markReady, () => null);
        })
            .then((fn) => {
                if (cancelled) fn();
                else unlisten = fn;
            })
            .catch(() => null);

        void sidecar.waitUntilReady().then(markReady, () => null);

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, [isActive]);

    // 뷰 활성화 시 연결 확인 + idle 동안 저주기 재확인 → 복구 시 예열 재진입 (#178).
    // non-idle에서는 온도 폴링 루프가 connected를 관리하므로 interval은 idle만.
    // ready 전에는 폴이 나가지 않는다 — 콜드 기동 401/Load failed를 끊김으로 승격하지 않기 위함.
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    useEffect(() => {
        if (!isActive || !sidecarReady) return;

        const idleWatch = phase === 'idle';
        if (idleWatch) setRoastLinkWatch(true);
        const check = () =>
            void checkSidecarAndRecoverIdle({
                getStatus: () => sidecar.getStatus(),
                getPhase: () => useRoastingStore.getState().phase,
                setConnected,
                enterPreheating,
                setReconnecting: (r) => useRoastingStore.getState().setReconnecting(r),
                setError: (err) => useRoastingStore.getState().setError(err),
                reportLink: idleWatch,
                onConnectedStatus: (status) => {
                    const snap = snapshotFromSidecar(status, useMachines.getState().machines);
                    if (snap) useRoastingStore.getState().rememberMachineSnapshot(snap);
                },
            });

        check(); // ready 이후 1회 (기존 isActive 전환 동작 보존)
        if (!idleWatch) return;
        const id = setInterval(check, IDLE_STATUS_POLL_MS);
        return () => {
            setRoastLinkWatch(false);
            clearInterval(id);
        };
    }, [isActive, phase, sidecarReady]);

    // 예열·대기·로스팅·종료 단계에서 주기적으로 온도를 폴링한다.
    // idle 단계에서만 폴링을 중단 — ended(요약 모달)에는 BBP 쿨다운 기록을 위해 폴링 유지.
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    useEffect(() => {
        if (phase === 'idle' || !sidecarReady) return;

        setRoastLinkWatch(true);
        let cancelled = false;
        // Holder so a poll can publish the decision from applyConnection without TS narrowing it to null.
        const noticed: { decision: { connected: boolean; reconnecting: boolean } | null } = { decision: null };
        const applyConnection = (decision: ReturnType<typeof classifySidecarConnection>) => {
            if (cancelled) return;
            noticed.decision = { connected: decision.connected, reconnecting: decision.reconnecting };
            const store = useRoastingStore.getState();
            store.setError(decision.error);
            store.setReconnecting(decision.reconnecting);
            setConnected(decision.connected);
        };

        const poll = async () => {
            if (pollInFlightRef.current) return;
            pollInFlightRef.current = true;
            noticed.decision = null;
            let skipLinkNotice = false;
            const epoch = captureLinkEpoch();
            const generation = sidecarGenerationRef.current;
            const machine = useRoastingStore.getState().machineSnapshot;
            // First snapshot after mount (null → machine) is a generation change too.
            if (machine !== lastMachineRef.current) {
                lastMachineRef.current = machine;
                btFilterRef.current = createBtFilter();
                rawBtFilterRef.current = createBtFilter();
                lastRawTimestampRef.current = null;
            }
            let rawSample: RawTemperatureSample | null = null;
            let rawBt: number | null = null;
            let observationTick: ReturnType<typeof sensorObservationTick> | null = null;
            const isCurrentGeneration = () =>
                !cancelled &&
                phase === useRoastingStore.getState().phase &&
                generation === sidecarGenerationRef.current &&
                machine === useRoastingStore.getState().machineSnapshot;
            const publishObservation = (tick: ReturnType<typeof sensorObservationTick>) => {
                observationTick = tick;
                if (!isCurrentGeneration()) return;
                const store = useRoastingStore.getState();
                store.updateRawTemperature(rawSample);
                store.updateSensorObservation(
                    reduceSensorObservation(store.observation, { ...tick, bt: tick.bt == null ? null : rawBt }),
                );
            };
            try {
                const data = await sidecar.getTemperatures();
                const receivedAtMs = Date.now();
                if (!isCurrentGeneration()) return;
                const deviceTimestamp = Number.isFinite(data.timestamp) ? data.timestamp : null;
                rawBt = finiteRawTemperature(data.bt_raw);
                const tick = (over: Parameters<typeof sensorObservationTick>[1] = {}) =>
                    sensorObservationTick(receivedAtMs, {
                        deviceTimestamp,
                        bt: data.bt ?? null,
                        stale: data.stale,
                        reconnecting: data.reconnecting,
                        ...over,
                    });
                if (!data.stale && !data.reconnecting && data.bt != null && data.bt_raw != null) {
                    rawSample = { timestamp: data.timestamp, receivedAtMs, bt: data.bt_raw };
                }
                // bt가 null이면 연결 끊김 가능성 → /status로 이중 확인
                if (data.bt === null || data.bt === undefined) {
                    publishObservation(tick({ bt: null }));
                    const status = await sidecar.getStatus().catch(() => null);
                    if (cancelled) return;
                    const decision = classifySidecarConnection({
                        kind: 'null_bt',
                        dataReconnecting: data.reconnecting,
                        status,
                    });
                    applyConnection(decision);
                    // hard disconnect or reconnecting hold — no live point this tick
                    if (!status?.connected) return;
                }
                // 글리치(스파이크·0값·단선) 샘플은 이 폴링 tick 전체를 스킵 — 자동감지 오발화 방지
                btFilterRef.current ??= createBtFilter();
                const bt = data.bt == null ? null : btFilterRef.current(data.bt, Date.now());
                if (data.bt != null && bt === null) {
                    // 거부된 글리치: 표시값은 유지하고 품질만 invalid
                    applyConnection(classifySidecarConnection({ kind: 'live', dataReconnecting: data.reconnecting }));
                    observationTick = tick({ spikeRejected: true, bt: data.bt });
                    return;
                }
                useRoastingStore.getState().updateLiveData({ ...data, bt });
                useRoastingStore.getState().setPid(data.pid ?? null);
                applyConnection(classifySidecarConnection({ kind: 'live', dataReconnecting: data.reconnecting }));
                observationTick = tick({ bt });
                if (bt === null) return;

                const { phase: currentPhase, roastStartMs, sessionId: currentSessionId } = useRoastingStore.getState();

                // BBP: 이전 드롭 이후 pre-charge 구간(ended/preheating/standby) 기록.
                // 비활성 시 no-op — 간격 제한·만료는 스토어 append가 처리.
                if (currentPhase !== 'roasting' && !data.stale) {
                    useBbpStore.getState().append(
                        {
                            bt,
                            btRaw: finiteRawTemperature(data.bt_raw),
                            etRaw: finiteRawTemperature(data.et_raw),
                            ror_et: data.ror_et ?? null,
                            sensorTimestamp: deviceTimestamp,
                            sensorClock: data.sensor_clock ?? null,
                            processing: data.processing,
                            et: data.et ?? null,
                            heater: data.heater ?? null,
                            fan: data.fan ?? 0,
                            drum: data.drum ?? 0,
                        },
                        Date.now(),
                    );
                    const liveBbp = useBbpStore.getState();
                    if (liveBbp.active && liveBbp.recording && liveBbp.points.length > 0) {
                        void writeBbpTsv(BBP_INPROGRESS_ID, bbpPointsToTsv(liveBbp.points)).catch(() => {});
                    }
                }

                if (currentPhase === 'roasting' && roastStartMs !== 0) {
                    const t = (Date.now() - roastStartMs) / 1000;
                    // Keep elapsed on wall-clock even if UI tick interval is throttled
                    const elapsedSec = Math.floor(t);
                    if (useRoastingStore.getState().elapsed !== elapsedSec) {
                        useRoastingStore.setState({ elapsed: elapsedSec });
                    }
                    // stale = last-good 재전송. 표시(updateLiveData)는 유지하되 시계열엔 안 쓴다
                    if (data.stale) return;
                    // 폴링 주기보다 짧은 간격은 무시해 중복 포인트를 방지한다.
                    const recordedPoints = useRoastingStore.getState().livePoints;
                    const lastRoastPointTime = recordedPoints[recordedPoints.length - 1]?.time ?? null;
                    if (lastRoastPointTime !== null && t >= lastRoastPointTime && t - lastRoastPointTime < 0.4) return;

                    const min = Math.floor(t / 60);
                    const sec = Math.floor(t % 60);
                    const point: LiveRoastPoint = {
                        time: t,
                        label: `${min}:${String(sec).padStart(2, '0')}`,
                        bt,
                        et: data.et ?? null,
                        ror: data.ror,
                        ror_et: data.ror_et ?? null,
                        heater: data.heater ?? null,
                        fan: data.fan ?? 0,
                        drum: data.drum ?? 0,
                        heaterSet: data.heater_set ?? null,
                        etRaw: finiteRawTemperature(data.et_raw),
                        btRaw: finiteRawTemperature(data.bt_raw),
                        sensorTimestamp: deviceTimestamp,
                        sensorClock: data.sensor_clock ?? null,
                        processing: data.processing,
                    };

                    if (currentSessionId) {
                        enqueueTsvRow(currentSessionId, formatRoastTsvRow(point), point.processing);
                    }
                    setLivePoints((prev) => [...prev, point]);
                } else if (currentPhase === 'standby') {
                    // 첫 배치 예열 표시. Charge 때 00:00 시작점으로 교체한다 (#452). BBP 대기는 스토어 차트.
                    const absTime = Date.now();
                    if (lastPreChargeAbsRef.current > 0 && absTime - lastPreChargeAbsRef.current < 400) return;
                    lastPreChargeAbsRef.current = absTime;

                    if (preChargeStartRef.current === 0) {
                        preChargeStartRef.current = absTime;
                    }

                    const sessionTime = (absTime - preChargeStartRef.current) / 1000;
                    const m = Math.floor(sessionTime / 60);
                    const s = Math.floor(sessionTime % 60);
                    setLivePoints((prev) => [
                        ...prev,
                        {
                            time: sessionTime,
                            label: `${m}:${String(s).padStart(2, '0')}`,
                            bt,
                            et: data.et ?? null,
                            ror: data.ror,
                            ror_et: data.ror_et ?? null,
                            heater: data.heater ?? null,
                            fan: data.fan ?? 0,
                            drum: data.drum ?? 0,
                            heaterSet: data.heater_set ?? null,
                            etRaw: finiteRawTemperature(data.et_raw),
                            btRaw: finiteRawTemperature(data.bt_raw),
                            sensorTimestamp: deviceTimestamp,
                            sensorClock: data.sensor_clock ?? null,
                            processing: data.processing,
                        },
                    ]);
                }
            } catch (e) {
                rawSample = null;
                logger.debug(e, 'sidecar polling error');
                publishObservation(sensorObservationTick(Date.now(), { pollError: true }));
                if (isUnauthorizedSidecar(e)) {
                    skipLinkNotice = true;
                    return;
                }
                // Transient HTTP/timeout must not wipe reconnecting or force hard disconnect
                // while the sidecar is still up or hardware auto-reconnect is running.
                const status = await sidecar.getStatus().catch((statusErr: unknown) => {
                    if (isUnauthorizedSidecar(statusErr)) return 'unauthorized' as const;
                    return null;
                });
                if (cancelled || status === 'unauthorized') {
                    if (status === 'unauthorized') skipLinkNotice = true;
                    return;
                }
                applyConnection(
                    classifySidecarConnection({
                        kind: 'poll_error',
                        status,
                    }),
                );
            } finally {
                pollInFlightRef.current = false;
                if (isCurrentGeneration()) {
                    const store = useRoastingStore.getState();
                    store.updateRawTemperature(rawSample);
                    if (observationTick) {
                        // Replay judges raw BT; display EMA must not validate a raw spike.
                        const rawTick = { ...observationTick, bt: observationTick.bt == null ? null : rawBt };
                        const quality = reduceSensorObservation(store.observation, rawTick).quality;
                        // Repeated/stale samples must not confirm a held spike as a real step.
                        if (quality === 'valid' && rawSample) {
                            rawBtFilterRef.current ??= createBtFilter();
                            const previousTimestamp = lastRawTimestampRef.current;
                            rawTick.spikeRejected =
                                (previousTimestamp != null && rawSample.timestamp <= previousTimestamp) ||
                                rawBtFilterRef.current(rawSample.bt, rawSample.timestamp * 1000) == null;
                            if (previousTimestamp == null || rawSample.timestamp > previousTimestamp) {
                                lastRawTimestampRef.current = rawSample.timestamp;
                            }
                        }
                        store.updateSensorObservation(reduceSensorObservation(store.observation, rawTick));
                    }
                    if (!skipLinkNotice) {
                        // applyConnection writes this. Control-flow only sees the reset to null.
                        const decision = noticed.decision as { connected: boolean; reconnecting: boolean } | null;
                        // Link recovery follows the reading, not the device-clock quality.
                        // A repeated timestamp is still a non-stale temperature (`retransmit` in the store).
                        observeRoastLink(
                            {
                                connected: decision?.connected,
                                reconnecting: decision?.reconnecting,
                                bt: observationTick?.bt,
                                observation: observationTick
                                    ? machineTemperatureQuality({
                                          bt: observationTick.bt,
                                          stale: observationTick.stale,
                                          reconnecting: observationTick.reconnecting || decision?.reconnecting,
                                          spike: observationTick.spikeRejected,
                                          pollError: observationTick.pollError,
                                      })
                                    : undefined,
                            },
                            epoch,
                        );
                    }
                }
            }
        };

        void poll();
        // Tauri: 호스트 500ms `sidecar-poll-tick` (숨김 setInterval 1s 정렬 회피).
        // 웹 전용/테스트: setInterval. pollIntervalMs가 1000이면 tick을 건너뛴다.
        if ('__TAURI_INTERNALS__' in window) {
            let last = Date.now();
            let unlisten: (() => void) | undefined;
            let fallbackId: ReturnType<typeof setInterval> | undefined;
            listen('sidecar-poll-tick', () => {
                const now = Date.now();
                if (!shouldAcceptTick(now, last, pollIntervalMs)) return;
                last = now;
                void poll();
            }).then(
                (fn) => {
                    if (cancelled) fn();
                    else unlisten = fn;
                },
                () => {
                    // listen 실패가 폴링 영구 정지가 되지 않도록 webview 타이머로 폴백
                    if (!cancelled) fallbackId = setInterval(() => void poll(), pollIntervalMs);
                },
            );
            return () => {
                setRoastLinkWatch(false);
                cancelled = true;
                unlisten?.();
                if (fallbackId !== undefined) clearInterval(fallbackId);
            };
        }
        const id = setInterval(() => void poll(), pollIntervalMs);
        return () => {
            setRoastLinkWatch(false);
            cancelled = true;
            clearInterval(id);
        };
    }, [phase, pollIntervalMs, sidecarReady]);

    return { livePoints, setLivePoints };
};
