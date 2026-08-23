import { createBtFilter } from '@features/active-roast/lib/btFilter';
import { useBbpStore } from '@features/active-roast/model/bbp';
import { useRoastingStore } from '@features/active-roast/model/status';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { enqueueTsvRow, initSessionTsv, writeBbpTsv } from '@shared/lib/tsv-writer';
import type { MutableRefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { classifySidecarConnection } from '../lib/classify-sidecar-connection';

/** 폴링 중 누적하는 실시간 측정 포인트 */
export interface LiveRoastPoint {
    time: number;
    label: string;
    bt: number;
    et: number | null;
    ror: number | null;
    ror_et: number | null;
    heater: number;
    fan: number;
    drum: number;
}

interface Params {
    /** 뷰가 화면에 노출되어 있는지 여부 (CSS hide → show 전환 감지) */
    isActive: boolean;
    /** 현재 로스팅 단계 */
    phase: string;
    /** 온도 폴링 주기 (ms) */
    pollIntervalMs: number;
    enterPreheating: (capabilities?: string[]) => void;
    setConnected: (connected: boolean, capabilities?: string[]) => void;
    /** Charge 시각 (ms). 0이면 로스팅 미시작 */
    roastStartTimeRef: MutableRefObject<number>;
    /** Charge 시 생성된 세션 UUID. null이면 미시작 */
    sessionId: string | null;
    /** Charge 이전 그래프에 표시할 구간 (초) */
    preChargeDisplaySec: number;
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
}): Promise<void> {
    try {
        const s = await deps.getStatus();
        if (s.connected) {
            deps.setReconnecting?.(false);
            deps.setError?.(null);
            deps.setConnected(true, s.capabilities);
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
        // reconnecting hold: do not enter preheating from idle until link is solid
    } catch {
        deps.setReconnecting?.(false);
        deps.setConnected(false);
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
    roastStartTimeRef,
    sessionId,
    preChargeDisplaySec,
}: Params) => {
    const [livePoints, setLivePoints] = useState<LiveRoastPoint[]>([]);
    // TSV writer ready — sessionId 변경 시 재초기화
    const tsvInitializedRef = useRef(false);
    // pre-charge 버퍼: absTime으로 누적 (charge 시 음수 상대 시간으로 변환에 사용)
    const preChargeBufferRef = useRef<(Omit<LiveRoastPoint, 'time' | 'label'> & { absTime: number })[]>([]);
    // preheating 첫 폴링 시각 — livePoints 실시간 표시용 세션 기준점
    const preChargeStartRef = useRef<number>(0);
    const prevPhaseRef = useRef(phase);
    // BT 이상치 필터 — 스파이크/0값이 자동감지(charge·TP·FC·drop) 윈도우에 들어가는 것을 차단
    const btFilterRef = useRef(createBtFilter());

    // sessionId가 새로 설정되면 TSV 파일을 헤더로 초기화한다.
    useEffect(() => {
        if (!sessionId) return;
        tsvInitializedRef.current = false;
        void initSessionTsv(sessionId)
            .then(() => {
                tsvInitializedRef.current = true;
            })
            .catch(() => {});
    }, [sessionId]);

    // phase → 'roasting' 전환 감지:
    // 버퍼를 음수 상대 시간으로 변환 후 livePoints를 교체한다.
    // (preheating 중 세션 상대 시간으로 쌓인 display 포인트는 버퍼 기반으로 덮어쓴다)
    useEffect(() => {
        if (prevPhaseRef.current !== 'roasting' && phase === 'roasting') {
            const chargeTime = roastStartTimeRef.current;
            // BBP 확정: 요약은 스토어(finalized)에 남고 커브는 로컬 TSV로 — 저장 시 업로드
            const bbpSessionId = useRoastingStore.getState().sessionId;
            const bbpResult = bbpSessionId
                ? useBbpStore.getState().finalize(chargeTime || Date.now(), bbpSessionId)
                : null;
            if (bbpResult && bbpSessionId) {
                void writeBbpTsv(bbpSessionId, bbpResult.tsv).catch((err) => {
                    logger.capture(err instanceof Error ? err : new Error(String(err)), {
                        context: 'bbp tsv write',
                        sessionId: bbpSessionId,
                    });
                });
            }
            let prePoints: LiveRoastPoint[] = [];
            if (chargeTime !== 0 && preChargeBufferRef.current.length > 0) {
                const cutoff = chargeTime - preChargeDisplaySec * 1000;
                prePoints = preChargeBufferRef.current
                    .filter((p) => p.absTime >= cutoff)
                    .map((p) => {
                        const relSec = (p.absTime - chargeTime) / 1000;
                        return {
                            ...p,
                            time: relSec,
                            label: formatLookbackLabel(relSec),
                        };
                    });
            }
            // 세션 상대 시간 display 포인트를 버퍼 기반 음수 포인트로 완전 교체
            setLivePoints(prePoints);
            preChargeBufferRef.current = [];
            preChargeStartRef.current = 0;
        }
        prevPhaseRef.current = phase;
    }, [phase, roastStartTimeRef, preChargeDisplaySec]);

    // 뷰 활성화 시 연결 확인 + idle 동안 저주기 재확인 → 복구 시 예열 재진입 (#178).
    // non-idle에서는 온도 폴링 루프가 connected를 관리하므로 interval은 idle만.
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    useEffect(() => {
        if (!isActive) return;

        const check = () =>
            void checkSidecarAndRecoverIdle({
                getStatus: () => sidecar.getStatus(),
                getPhase: () => useRoastingStore.getState().phase,
                setConnected,
                enterPreheating,
                setReconnecting: (r) => useRoastingStore.getState().setReconnecting(r),
                setError: (err) => useRoastingStore.getState().setError(err),
            });

        check(); // 즉시 1회 (기존 isActive 전환 동작 보존)
        if (phase !== 'idle') return;
        const id = setInterval(check, IDLE_STATUS_POLL_MS);
        return () => clearInterval(id);
    }, [isActive, phase]);

    // 예열·대기·로스팅·종료 단계에서 주기적으로 온도를 폴링한다.
    // idle 단계에서만 폴링을 중단 — ended(요약 모달)에는 BBP 쿨다운 기록을 위해 폴링 유지.
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    useEffect(() => {
        if (phase === 'idle') return;

        let cancelled = false;
        const applyConnection = (decision: ReturnType<typeof classifySidecarConnection>) => {
            if (cancelled) return;
            const store = useRoastingStore.getState();
            store.setError(decision.error);
            store.setReconnecting(decision.reconnecting);
            setConnected(decision.connected);
        };

        const poll = async () => {
            try {
                const data = await sidecar.getTemperatures();
                if (cancelled) return;
                // bt가 null이면 연결 끊김 가능성 → /status로 이중 확인
                if (data.bt === null || data.bt === undefined) {
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
                const bt = data.bt == null ? null : btFilterRef.current(data.bt, Date.now());
                if (data.bt != null && bt === null) {
                    // 거부된 글리치: 표시값 깜빡임 방지 위해 store 갱신도 스킵
                    applyConnection(classifySidecarConnection({ kind: 'live', dataReconnecting: data.reconnecting }));
                    return;
                }
                useRoastingStore.getState().updateLiveData({ ...data, bt });
                useRoastingStore.getState().setPid(data.pid ?? null);
                applyConnection(classifySidecarConnection({ kind: 'live', dataReconnecting: data.reconnecting }));
                if (bt === null) return;

                const currentPhase = useRoastingStore.getState().phase;

                // BBP: 이전 드롭 이후 pre-charge 구간(ended/preheating/standby) 기록.
                // 비활성 시 no-op — 간격 제한·만료는 스토어 append가 처리.
                if (currentPhase !== 'roasting') {
                    useBbpStore.getState().append(
                        {
                            bt,
                            et: data.et ?? null,
                            heater: data.heater ?? 0,
                            fan: data.fan ?? 0,
                            drum: data.drum ?? 0,
                        },
                        Date.now(),
                    );
                }

                if (currentPhase === 'roasting' && roastStartTimeRef.current !== 0) {
                    // post-charge: same origin as store.roastStartMs / elapsed
                    const t = (Date.now() - roastStartTimeRef.current) / 1000;
                    // Keep elapsed on wall-clock even if UI tick interval is throttled
                    const elapsedSec = Math.floor(t);
                    if (useRoastingStore.getState().elapsed !== elapsedSec) {
                        useRoastingStore.setState({ elapsed: elapsedSec });
                    }
                    setLivePoints((prev) => {
                        // 폴링 주기보다 짧은 간격은 무시해 중복 포인트를 방지한다.
                        if (prev.length > 0 && t - prev[prev.length - 1].time < 0.4) return prev;
                        const min = Math.floor(t / 60);
                        const sec = Math.floor(t % 60);
                        const point: LiveRoastPoint = {
                            time: t,
                            label: `${min}:${String(sec).padStart(2, '0')}`,
                            bt,
                            et: data.et ?? null,
                            ror: data.ror,
                            ror_et: data.ror_et ?? null,
                            heater: data.heater ?? 0,
                            fan: data.fan ?? 0,
                            drum: data.drum ?? 0,
                        };

                        // TSV에 데이터 포인트 추가 (serial write queue)
                        const currentSessionId = useRoastingStore.getState().sessionId;
                        if (tsvInitializedRef.current && currentSessionId) {
                            const row = `${t.toFixed(2)}\t${bt}\t${data.et ?? ''}\t${data.ror ?? ''}\t${data.heater ?? 0}\t${data.fan ?? 0}\t${data.drum ?? 0}\n`;
                            enqueueTsvRow(currentSessionId, row);
                        }

                        return [...prev, point];
                    });
                } else if (currentPhase === 'standby') {
                    // pre-charge: 버퍼(absTime)와 livePoints(세션 상대 시간) 동시 기록
                    const absTime = Date.now();
                    const buf = preChargeBufferRef.current;
                    if (buf.length > 0 && absTime - buf[buf.length - 1].absTime < 400) return;

                    // 첫 폴링 시 세션 기준점 설정
                    if (preChargeStartRef.current === 0) {
                        preChargeStartRef.current = absTime;
                    }

                    const pointData = {
                        bt,
                        et: data.et ?? null,
                        ror: data.ror,
                        ror_et: data.ror_et ?? null,
                        heater: data.heater ?? 0,
                        fan: data.fan ?? 0,
                        drum: data.drum ?? 0,
                    };

                    // 버퍼: charge 시 음수 상대 시간 변환에 사용
                    buf.push({ absTime, ...pointData });
                    if (buf.length > 1200) buf.splice(0, buf.length - 1200);

                    // livePoints: 세션 상대 시간으로 차트에 실시간 표시
                    const sessionTime = (absTime - preChargeStartRef.current) / 1000;
                    const m = Math.floor(sessionTime / 60);
                    const s = Math.floor(sessionTime % 60);
                    setLivePoints((prev) => [
                        ...prev,
                        {
                            time: sessionTime,
                            label: `${m}:${String(s).padStart(2, '0')}`,
                            ...pointData,
                        },
                    ]);
                }
            } catch (e) {
                logger.debug(e, 'sidecar polling error');
                // Transient HTTP/timeout must not wipe reconnecting or force hard disconnect
                // while the sidecar is still up or hardware auto-reconnect is running.
                const status = await sidecar.getStatus().catch(() => null);
                if (cancelled) return;
                applyConnection(
                    classifySidecarConnection({
                        kind: 'poll_error',
                        status,
                    }),
                );
            }
        };

        void poll();
        const id = setInterval(() => void poll(), pollIntervalMs);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [phase, pollIntervalMs]);

    return { livePoints, setLivePoints };
};
