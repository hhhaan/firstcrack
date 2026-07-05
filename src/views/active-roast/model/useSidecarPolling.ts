import { useRoastingStore } from '@features/active-roast/model/status';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs';
import type { MutableRefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

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

const TAURI = '__TAURI_INTERNALS__' in window;
const TSV_HEADER = 'time\tbt\tet\tror\theater\tfan\tdrum\n';

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
    // TSV 파일 헤더가 작성됐는지 추적 — sessionId가 바뀌면 다시 false로 리셋된다.
    const tsvInitializedRef = useRef(false);
    // pre-charge 버퍼: absTime으로 누적 (charge 시 음수 상대 시간으로 변환에 사용)
    const preChargeBufferRef = useRef<(Omit<LiveRoastPoint, 'time' | 'label'> & { absTime: number })[]>([]);
    // preheating 첫 폴링 시각 — livePoints 실시간 표시용 세션 기준점
    const preChargeStartRef = useRef<number>(0);
    const prevPhaseRef = useRef(phase);

    // sessionId가 새로 설정되면 TSV 파일을 헤더로 초기화한다.
    useEffect(() => {
        if (!sessionId || !TAURI) return;
        tsvInitializedRef.current = false;
        writeTextFile(`session_${sessionId}.tsv`, TSV_HEADER, { baseDir: BaseDirectory.AppLocalData })
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
            let prePoints: LiveRoastPoint[] = [];
            if (chargeTime !== 0 && preChargeBufferRef.current.length > 0) {
                const cutoff = chargeTime - preChargeDisplaySec * 1000;
                prePoints = preChargeBufferRef.current
                    .filter((p) => p.absTime >= cutoff)
                    .map((p) => {
                        const relSec = (p.absTime - chargeTime) / 1000; // 음수
                        const absT = Math.abs(relSec);
                        const m = Math.floor(absT / 60);
                        const s = Math.floor(absT % 60);
                        return {
                            ...p,
                            time: relSec,
                            label: `-${m}:${String(s).padStart(2, '0')}`,
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

    // 뷰가 활성화될 때 연결 상태를 확인하고 idle 상태면 예열 단계로 진입한다.
    useEffect(() => {
        if (!isActive) return;
        sidecar
            .getStatus()
            .then((s) => {
                if (s.connected) {
                    setConnected(true, s.capabilities);
                    if (useRoastingStore.getState().phase === 'idle') {
                        enterPreheating(s.capabilities);
                    }
                } else {
                    setConnected(false);
                }
            })
            .catch(() => setConnected(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive]);

    // 예열·대기·로스팅 단계에서 주기적으로 온도를 폴링한다.
    // idle / ended 단계에서는 폴링을 중단해 불필요한 IPC 호출을 막는다.
    useEffect(() => {
        if (phase === 'idle' || phase === 'ended') return;

        const poll = async () => {
            try {
                const data = await sidecar.getTemperatures();
                // bt가 null이면 연결 끊김 가능성 → /status로 이중 확인
                if (data.bt == null) {
                    const status = await sidecar.getStatus().catch(() => null);
                    if (!status?.connected) {
                        useRoastingStore.getState().setError(status?.error ?? null);
                        setConnected(false);
                        return;
                    }
                }
                useRoastingStore.getState().updateLiveData(data);
                useRoastingStore.getState().setReconnecting(data.reconnecting ?? false);
                setConnected(true);
                const bt = data.bt;
                if (bt == null) return;

                const currentPhase = useRoastingStore.getState().phase;

                if (currentPhase === 'roasting' && roastStartTimeRef.current !== 0) {
                    // post-charge: 기존 livePoints 기록 로직
                    const t = (Date.now() - roastStartTimeRef.current) / 1000;
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

                        // TSV에 데이터 포인트 추가
                        const currentSessionId = useRoastingStore.getState().sessionId;
                        if (TAURI && tsvInitializedRef.current && currentSessionId) {
                            const row = `${t.toFixed(2)}\t${bt}\t${data.et ?? ''}\t${data.ror ?? ''}\t${data.heater ?? 0}\t${data.fan ?? 0}\t${data.drum ?? 0}\n`;
                            writeTextFile(`session_${currentSessionId}.tsv`, row, {
                                baseDir: BaseDirectory.AppLocalData,
                                append: true,
                            }).catch(() => {});
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
                const status = await sidecar.getStatus().catch(() => null);
                useRoastingStore.getState().setError(status?.error ?? null);
                useRoastingStore.getState().setReconnecting(false);
                setConnected(false);
            }
        };

        poll();
        const id = setInterval(poll, pollIntervalMs);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, pollIntervalMs]);

    return { livePoints, setLivePoints };
};
