import { useState, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { sidecar } from '@shared/lib/sidecar';
import { useRoastingStore } from '@features/active-roast/model/status';

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
    /** TP 확정 시각 (초). null이면 미확정 */
    tpTimeSecRef: MutableRefObject<number | null>;
}

/**
 * 사이드카(파이썬 프로세스)와의 연결 상태를 관리하고,
 * 로스팅 중 온도를 주기적으로 폴링해 livePoints 배열을 누적한다.
 *
 * livePoints는 차트·자동감지 훅에서 공유되므로 이 훅에서 소유한다.
 * resetActiveRoast 등 외부에서 초기화가 필요할 때를 위해 setLivePoints도 반환한다.
 */
export const useSidecarPolling = ({
    isActive,
    phase,
    pollIntervalMs,
    enterPreheating,
    setConnected,
    roastStartTimeRef,
}: Params) => {
    const [livePoints, setLivePoints] = useState<LiveRoastPoint[]>([]);

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
                        setConnected(false);
                        return;
                    }
                }
                useRoastingStore.getState().updateLiveData(data);
                setConnected(true);
                const bt = data.bt;

                // 로스팅 단계에서만 측정값을 livePoints에 기록한다.
                if (useRoastingStore.getState().phase === 'roasting' && bt != null && roastStartTimeRef.current !== 0) {
                    const t = (Date.now() - roastStartTimeRef.current) / 1000;
                    setLivePoints((prev) => {
                        // 폴링 주기보다 짧은 간격은 무시해 중복 포인트를 방지한다.
                        if (prev.length > 0 && t - prev[prev.length - 1].time < 0.4) return prev;
                        const min = Math.floor(t / 60);
                        const sec = Math.floor(t % 60);
                        return [
                            ...prev,
                            {
                                time: t,
                                label: `${min}:${String(sec).padStart(2, '0')}`,
                                bt,
                                et: data.et ?? null,
                                ror: data.ror,
                                ror_et: data.ror_et ?? null,
                                heater: data.heater ?? 0,
                                fan: data.fan ?? 0,
                                drum: data.drum ?? 0,
                            },
                        ];
                    });
                }
            } catch {
                setConnected(false);
            }
        };

        poll();
        const id = setInterval(poll, pollIntervalMs);
        return () => clearInterval(id);
    }, [phase, pollIntervalMs]);

    return { livePoints, setLivePoints };
};
