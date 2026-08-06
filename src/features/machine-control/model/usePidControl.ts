import type { PidCapability, PidRuntime } from '@entities/machine';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { useToastStore } from '@shared/store/toast';
import { useCallback, useEffect, useState } from 'react';

/** 서버가 SV 범위를 알려주기 전 슬라이더 초기값 */
const FALLBACK_SV_C = 200;

const reportError = (err: unknown, fallback: string) => {
    logger.error('[pid]', err);
    useToastStore.getState().show(err instanceof Error ? err.message : fallback, 'error');
};

/**
 * 소프트웨어 PID 조작.
 *
 * 런타임 상태(state/duty/pv)는 /temperatures 폴링이 실어 오므로 여기서 따로
 * 폴링하지 않는다. 이 훅은 켜기/끄기/SV 변경과 자동 해제만 담당한다.
 *
 * **자동 해제**는 이 훅의 존재 이유다. 배출·연결 끊김·로스팅 종료 뒤에도 PID가
 * 살아 있으면 사람이 보고 있지 않은 로스터에 계속 불을 넣는다.
 */
export const usePidControl = ({
    sidecarConnected,
    capability,
    runtime,
    /** 배출/종료 등 "이 로스트는 끝났다" 신호 */
    roastFinished,
    /** DROP 시 화력 처리 — 설정에서 온다 */
    dropBehavior,
}: {
    sidecarConnected: boolean;
    capability: PidCapability | undefined;
    runtime: PidRuntime | null;
    roastFinished: boolean;
    dropBehavior: 'hold' | 'zero';
}) => {
    const [sv, setSv] = useState<number>(FALLBACK_SV_C);
    const [busy, setBusy] = useState(false);

    const state = runtime?.state ?? 'off';
    // 사이드카가 보고하는 상태가 유일한 진실 — 로컬 토글 상태를 따로 들면
    // 실패한 켜기가 UI에서는 켜진 것처럼 보인다.
    const engaged = state === 'running' || state === 'holding';

    const turnOn = useCallback(async () => {
        setBusy(true);
        try {
            await sidecar.pidOn(sv);
        } catch (err) {
            reportError(err, 'PID를 켜지 못했습니다.');
        } finally {
            setBusy(false);
        }
    }, [sv]);

    const turnOff = useCallback(async (mode: 'hold' | 'zero') => {
        setBusy(true);
        try {
            await sidecar.pidOff(mode);
        } catch (err) {
            reportError(err, 'PID를 끄지 못했습니다.');
        } finally {
            setBusy(false);
        }
    }, []);

    const commitSv = useCallback(
        async (next: number) => {
            setSv(next);
            if (!engaged) return; // OFF면 다음 시작 때 반영된다
            try {
                await sidecar.pidSetSv(next);
            } catch (err) {
                reportError(err, '목표 온도를 바꾸지 못했습니다.');
            }
        },
        [engaged],
    );

    // 로스트 종료(배출 포함) → 설정된 방식으로 해제.
    // 연결이 없으면 보낼 경로도 없다 — 사이드카가 스스로 FAULT 처리한다.
    useEffect(() => {
        if (!roastFinished || !engaged || !sidecarConnected) return;
        void turnOff(dropBehavior);
    }, [roastFinished, engaged, sidecarConnected, dropBehavior, turnOff]);

    return {
        supported: Boolean(capability?.supported) && sidecarConnected,
        svMin: capability?.sv_min ?? 50,
        svMax: capability?.sv_max ?? 250,
        sv,
        state,
        engaged,
        busy,
        duty: runtime?.duty ?? null,
        pv: runtime?.pv ?? null,
        error: runtime?.error ?? null,
        turnOn,
        turnOff,
        commitSv,
    };
};
