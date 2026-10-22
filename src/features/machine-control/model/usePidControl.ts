import type { PidCapability, PidRuntime } from '@entities/machine';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { useToastStore } from '@shared/store/toast';
import { useCallback, useEffect, useRef, useState } from 'react';

/** 서버가 SV 범위를 알려주기 전 슬라이더 초기값 */
const FALLBACK_SV_C = 200;

/**
 * 자동 해제 실패 후 재시도 간격.
 * 매 시도가 busy를 세우고, 수동 OFF 버튼은 busy에 걸려 있다 — 더 짧게 잡으면
 * 정작 사람이 개입해야 하는 순간에 버튼을 못 누른다.
 */
const PID_OFF_RETRY_MS = 5000;

const reportError = (err: unknown, fallback: string) => {
    // PID 요청 실패는 화력 안전과 직결 — production에서도 관측한다 (#269)
    logger.capture(err, { feature: 'machine-control', action: 'pid', fallback });
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
    curveOwned = false,
}: {
    sidecarConnected: boolean;
    capability: PidCapability | undefined;
    runtime: PidRuntime | null;
    roastFinished: boolean;
    dropBehavior: 'hold' | 'zero';
    curveOwned?: boolean;
}) => {
    const [sv, setSv] = useState<number>(FALLBACK_SV_C);
    const [busy, setBusy] = useState(false);
    /** 자동 해제 실패 횟수 — deps에 들어가 재시도 effect를 다시 발사시킨다 */
    const [offAttempt, setOffAttempt] = useState(0);
    const svAdoptedRef = useRef(false);

    const state = curveOwned ? 'off' : (runtime?.state ?? 'off');
    // 사이드카가 보고하는 상태가 유일한 진실 — 로컬 토글 상태를 따로 들면
    // 실패한 켜기가 UI에서는 켜진 것처럼 보인다.
    const engaged = state === 'running' || state === 'holding';

    const turnOn = useCallback(async () => {
        if (curveOwned) return;
        setBusy(true);
        try {
            await sidecar.pidOn(sv);
        } catch (err) {
            reportError(err, 'PID를 켜지 못했습니다.');
        } finally {
            setBusy(false);
        }
    }, [sv, curveOwned]);

    /** 성공 여부를 돌려준다 — 자동 해제가 실패를 알아야 재시도할 수 있다.
     * notify=false는 재시도. 쓰기는 계속하되 토스트/Sentry는 첫 실패만. */
    const turnOff = useCallback(
        async (mode: 'hold' | 'zero', notify = true) => {
            if (curveOwned) return false;
            setBusy(true);
            try {
                await sidecar.pidOff(mode);
                return true;
            } catch (err) {
                if (notify) reportError(err, 'PID를 끄지 못했습니다.');
                return false;
            } finally {
                setBusy(false);
            }
        },
        [curveOwned],
    );

    /** 슬라이더를 끄는 동안의 화면 갱신만 — 머신에는 보내지 않는다 */
    const previewSv = useCallback((next: number) => setSv(next), []);

    /**
     * 실제 목표 온도 변경. 슬라이더에서 손을 뗀 시점에만 부른다.
     * 드래그 중 매 스텝을 보내면 켜져 있는 버너의 목표가 픽셀마다 흔들린다.
     */
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

    // 이미 돌고 있는 PID에 뒤늦게 붙은 경우(리마운트, 앱 재시작) 사이드카 SV가 진실이다.
    // 맞추지 않으면 슬라이더는 200을 보여주고, 다음 조작이 엉뚱한 값으로 점프시킨다.
    useEffect(() => {
        if (svAdoptedRef.current || !engaged || runtime?.sv == null) return;
        svAdoptedRef.current = true;
        setSv(runtime.sv);
    }, [engaged, runtime?.sv]);

    useEffect(() => {
        if (!engaged) svAdoptedRef.current = false;
    }, [engaged]);

    // 로스트 종료(배출 포함) → 설정된 방식으로 해제.
    // 연결이 없으면 보낼 경로도 없다 — 사이드카가 스스로 FAULT 처리한다.
    //
    // 실패하면 재시도한다. HTTP 한 번 실패하고 포기하면 아무도 보고 있지 않은
    // 로스터에 불이 계속 들어가 있다 — 사이드카에는 배출을 인지하는 안전망이 없다.
    // 시도 횟수 상한을 두지 않는 이유도 같다. 사이드카가 off를 반영하면
    // 루프가 끝난다.
    //
    // 판정을 engaged가 아니라 state !== 'off'로 두는 이유: safe-off 쓰기 실패 시
    // 사이드카는 FAULT로 남는다(#269). engaged(running/holding) 기준이면 그 순간
    // 재시도가 죽어, 화력이 남았는데 아무도 다시 끄려 하지 않는다.
    const needsOff = state !== 'off';
    useEffect(() => {
        if (!roastFinished || !needsOff || !sidecarConnected) return;
        let cancelled = false;
        const timer = setTimeout(
            () => {
                void turnOff(dropBehavior, offAttempt === 0).then((ok) => {
                    if (!ok && !cancelled) setOffAttempt((n) => n + 1);
                });
            },
            offAttempt === 0 ? 0 : PID_OFF_RETRY_MS,
        );
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [roastFinished, needsOff, sidecarConnected, dropBehavior, turnOff, offAttempt]);

    // 다음 로스트의 첫 해제가 지난 배치의 재시도 지연을 물려받지 않게 되돌린다
    useEffect(() => {
        if (!roastFinished) setOffAttempt(0);
    }, [roastFinished]);

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
        previewSv,
        commitSv,
    };
};
