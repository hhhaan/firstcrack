import { useCallback, useEffect, useMemo, useState } from 'react';
import { extractReplayEvents, judgeReplay, type ReplayEvent, type ReplayPoint } from '../lib/replay';

export interface ReplayControlInputs {
    /** 타겟 프로파일 커브 (charge 기준 상대 시간) — 없으면 Replay 비활성 */
    referencePoints: ReplayPoint[] | null;
    /** 레퍼런스의 charge→drop 초 — 배출 후 기록(쿨다운 조작)을 재생에서 제외한다 */
    referenceDropTime: number | null;
    liveBt: number | null;
    elapsed: number;
    /** phase === 'roasting' — 이 밖에서는 판정도 쓰기도 하지 않는다 */
    roasting: boolean;
    /** 실기 TP 확정 여부 — 하강 구간 BT 트리거 오발 방지 게이트 */
    afterTurningPoint: boolean;
    heaterWritable: boolean;
    /** PID가 off가 아니면 Replay 불가 — 히터 소유권은 하나 */
    pidEngaged: boolean;
    roastFinished: boolean;
    sidecarConnected: boolean;
    /** 지시했는데 기기가 안 따라온 상태 — 재생을 계속 밀어붙이지 않는다 (#269) */
    heaterUnacknowledged: boolean;
    writeHeater: (value: number) => void;
}

/**
 * 배출 후 초기 화력 reset까지의 유예 (#316, 정책은 #300).
 * 즉시 쓰지 않는 이유: DROP 직후는 배출 조작(문 열기 등)과 겹쳐 순간 개입이 잦다.
 */
const RESET_DELAY_MS = 5000;

/** 재생 중지 사유 — 'finished'는 배치 종료라 UI에 표시하지 않는다 */
export type ReplayStopReason =
    | 'disconnected'
    | 'pid'
    | 'unacknowledged'
    | 'unwritable'
    | 'finished'
    | 'manual'
    | 'profileChanged';

/**
 * Replay Assist 수명 관리 (#300). 판정은 lib/replay의 순수 함수가 하고,
 * 이 훅은 켜기/끄기와 안전 중지만 담당한다.
 *
 * 기본 OFF, 명시적 토글로만 시작. 슬라이더·PID·끊김으로 멈춰도 인덱스는 남긴다.
 * 다시 켜면 남은 이벤트부터 이어간다 — 지난 값을 다시 쓰지 않는다.
 * 단, 배치 안에서만이다 — 새 배치가 시작되면 인덱스는 처음으로 돌아간다.
 */
export const useReplayControl = ({
    referencePoints,
    referenceDropTime,
    liveBt,
    elapsed,
    roasting,
    afterTurningPoint,
    heaterWritable,
    pidEngaged,
    roastFinished,
    sidecarConnected,
    heaterUnacknowledged,
    writeHeater,
}: ReplayControlInputs) => {
    const plan = useMemo(
        () =>
            referencePoints && referencePoints.length > 0
                ? extractReplayEvents(referencePoints, referenceDropTime)
                : null,
        [referencePoints, referenceDropTime],
    );

    const [active, setActive] = useState(false);
    const [index, setIndex] = useState(0);
    /** 마지막 자동/수동 중지 사유 — 토글 재시작 전까지 UI에 지속 표시 */
    const [stopReason, setStopReason] = useState<ReplayStopReason | null>(null);
    /** 배출 후 되돌릴 초기 화력 — null이면 예약 없음. 재생 중 배출됐을 때만 잡힌다 (#316) */
    const [pendingReset, setPendingReset] = useState<number | null>(null);

    // 레퍼런스가 바뀌면 진행 중인 재생은 무효 — 옛 인덱스로 새 계획을 재생하면 안 된다.
    // effect가 아니라 렌더 중 리셋인 이유: effect로 하면 plan이 바뀐 커밋에서 아래 판정
    // effect가 stale active + 옛 index + 새 plan으로 한 번 실행돼 엉뚱한 쓰기를 쏠 수 있다.
    const [prevPlan, setPrevPlan] = useState(plan);
    if (plan !== prevPlan) {
        setPrevPlan(plan);
        setIndex(0);
        if (active) {
            setActive(false);
            setStopReason('profileChanged');
        }
    }

    // 배치 경계(roasting 양쪽 에지)에서 인덱스를 되돌린다 — 남은 인덱스는 이전 배치
    // 것이라, 상승 에지만 리셋하면 차지 전(standby/preheat)에 토글을 켰을 때 stale
    // 인덱스가 "모든 이벤트 재생 완료"로 새어나온다. 이전 배치의 중지 사유도 함께
    // 지운다 — 새 배치 패널에 지난 'pid'/'manual' 안내가 남으면 안 된다.
    // reconnect 중에는 phase가 유지되므로(#233) 순간 끊김으로는 오리셋되지 않는다.
    const [prevRoasting, setPrevRoasting] = useState(roasting);
    if (roasting !== prevRoasting) {
        setPrevRoasting(roasting);
        setIndex(0);
        setStopReason(null);
        // 상승 에지: 이전 배치의 reset timer가 새 배치 화력을 덮으면 안 된다 (#316).
        // 하강 에지(배출)는 무해하다 — 예약은 이 리셋 뒤의 중지 effect에서 잡힌다.
        setPendingReset(null);
    }

    const stop = useCallback(() => {
        // 수동 개입은 active 여부와 무관하게 예약된 reset을 취소한다 —
        // 배출 후 5초 안에 사람이 만진 화력을 timer가 덮으면 안 된다 (#316)
        setPendingReset(null);
        if (!active) return;
        setActive(false);
        setStopReason('manual');
    }, [active]);

    // 안전 중지 — 조건이 하나라도 성립하는 동안 active로 남아 있으면 안 된다
    const stopCause: ReplayStopReason | null = !sidecarConnected
        ? 'disconnected'
        : pidEngaged
          ? 'pid'
          : heaterUnacknowledged
            ? 'unacknowledged'
            : !heaterWritable
              ? 'unwritable'
              : roastFinished
                ? 'finished'
                : null;
    useEffect(() => {
        if (!active || stopCause == null) return;
        setActive(false);
        setStopReason(stopCause);
        // 재생이 화력을 잡은 채 배출됐다 — 마지막 재생 값이 실기기에 남으므로
        // 레퍼런스 초기 화력으로 되돌릴 것을 예약한다 (#316). stopCause 라벨이
        // 'disconnected' 등으로 밀려도 배출과 동시면 예약한다 — 우선순위 때문에
        // 'finished'만 보면 "끊김+배출" 커밋에서 아무도 불을 못 끈다.
        if (roastFinished) setPendingReset(plan?.events[0]?.heater ?? null);
    }, [active, stopCause, roastFinished, plan]);

    // 예약된 초기 화력 reset. 끊겨 있으면 보낼 경로가 없다 — 재연결되면 그때부터
    // 다시 5초 세고 쓴다. 실패 시 재시도는 하지 않는다: 값이 flame-off가 아니라
    // 재가동 값이라, 조용한 재시도 루프가 사람 개입과 싸우는 쪽이 더 위험하다.
    // 실패 관측은 기존 경로가 한다 — HTTP 실패는 토스트+Sentry(controlSender.onError),
    // 기기 미반영은 unacknowledged 경고. 이것이 #316이 요구하는 명시 정책이다.
    useEffect(() => {
        if (pendingReset == null || !sidecarConnected) return;
        const timer = setTimeout(() => {
            setPendingReset(null);
            writeHeater(pendingReset);
        }, RESET_DELAY_MS);
        return () => clearTimeout(timer);
    }, [pendingReset, sidecarConnected, writeHeater]);

    const toggle = useCallback(() => {
        if (active) {
            setActive(false);
            setStopReason(null); // 사용자가 직접 껐다 — 안내할 사유가 없다
            return;
        }
        if (plan == null || stopCause != null) return;
        setStopReason(null);
        setActive(true);
    }, [active, plan, stopCause]);

    // 매 온도 샘플 판정. elapsed도 deps에 있어 BT가 정체해도 시간 트리거는 진행한다.
    // stopCause 가드: pidEngaged/unacknowledged는 새 liveBt와 같은 폴링 커밋에 바뀐다 —
    // 위 중지 effect의 setActive(false)는 다음 렌더에나 반영되므로, 같은 커밋의 이
    // effect가 stale active로 한 번 더 쓰는 것을 여기서 막아야 한다.
    useEffect(() => {
        if (!active || stopCause != null || !roasting || liveBt == null || plan == null) return;
        const result = judgeReplay(plan, index, { bt: liveBt, elapsed, afterTurningPoint });
        if (result.nextIndex === index) return;
        setIndex(result.nextIndex);
        if (result.heater != null) writeHeater(result.heater);
    }, [active, stopCause, roasting, liveBt, elapsed, afterTurningPoint, plan, index, writeHeater]);

    const nextEvent: ReplayEvent | null = active && plan ? (plan.events[index] ?? null) : null;

    return {
        /** 레퍼런스에 heater 기록이 있고(합성/PID 기록 아님) 쓰기 가능한가 */
        available: plan != null && heaterWritable && sidecarConnected,
        /** 지금 켤 수 없는 상태(PID 점유 등) — 토글이 침묵 무시되므로 UI는 disabled로 보여야 한다 */
        blocked: stopCause != null,
        active,
        /** 마지막 중지 사유 — 재시작·직접 끄기 전까지 유지. UI 안내용 */
        stopReason,
        /** 다음에 발화할 이벤트 — UI 미리보기용. 다 소진했으면 null */
        nextEvent,
        toggle,
        /** 수동 개입 시 부모가 부른다 — 슬라이더 onChange에서, Replay 자신의 쓰기 경로에서는 부르지 않는다 */
        stop,
    };
};
