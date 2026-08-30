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
    /**
     * 배출 시 화력 정책 — pidDropBehavior 공용 (#316). PID든 Replay든 "DROP 후
     * 화력을 어떻게 둘지"는 한 정책이다. zero면 배출 즉시 heater 0을 쓴다(PID
     * off와 같은 타이밍 — 유예를 두면 Drop 취소·End 확정과 얽혀 오발/누락이 생긴다).
     * hold면 마지막 재생 값을 남긴다 — 설정으로 선택된, 문서화된 잔류다.
     */
    dropBehavior: 'hold' | 'zero';
    /** heater 실측 — Replay 마지막 확정 명령과의 지속 이탈 감지용 (#307) */
    heaterFeedback: number | null;
    /** heater 지시가 아직 수렴하지 않았다(desired 잔존) — settling 동안은 이탈 판정 제외 */
    heaterPending: boolean;
    writeHeater: (value: number) => void;
}

/** 재생 중지 사유 — 'finished'는 배치 종료라 UI에 표시하지 않는다 */
export type ReplayStopReason =
    | 'disconnected'
    | 'pid'
    | 'unacknowledged'
    | 'unwritable'
    | 'finished'
    | 'manual'
    | 'profileChanged'
    | 'controlDiverged';

/**
 * 마지막 확정 명령에서 실측이 이만큼 **초과** 이탈하면 외부 개입 후보로 센다.
 * 수렴 잔차(CONVERGE_TOLERANCE=1) + 리드백 노이즈 ±1이 겹친 최악 정상치가 정확히 2라
 * 초과(>) 판정이어야 오탐이 없다.
 * ponytail: 고정 deadband — 아날로그 duty 리드백이 더 시끄러운 기종이 나오면 머신별 설정으로.
 */
const DIVERGE_TOLERANCE = 2;
/** 이탈이 이만큼의 elapsed 틱(≈1초) 연속이어야 확정 — 순간 스파이크 제외 */
const DIVERGE_TICKS = 3;

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
    dropBehavior,
    heaterFeedback,
    heaterPending,
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
    /** zero 정책의 safe-off write가 나갔다 — 기기가 따라올 때까지 재시도 대상 (#316) */
    const [safeOffIssued, setSafeOffIssued] = useState(false);
    /**
     * Replay가 마지막으로 쓴 화력 — 수렴 후 실측과의 비교 기준 (#307). 이탈의 원인
     * (사람 조작반·본체 Auto·안전 인터락·타 소프트웨어)은 구분할 수 없고 하지도
     * 않는다 — 대응이 모두 "재생 중지"로 같다.
     */
    const [lastWritten, setLastWritten] = useState<number | null>(null);
    const [diverge, setDiverge] = useState({ tick: elapsed, ticks: 0 });
    /** 이탈 확정 후 배치 끝까지 재생 금지 — 재개하면 다음 이벤트가 개입을 또 덮는다 */
    const [divergedLock, setDivergedLock] = useState(false);

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
        // 상승 에지(새 배치 차지)에서만 지운다 — 이전 배치의 safe-off 재시도가 새
        // 배치 화력을 덮으면 안 된다. 하강 에지(End Roast 확정)에서 지우면 안 되는
        // 이유: Drop은 phase를 안 바꾸므로 safe-off는 roasting 중에 발행되고, 몇 초
        // 뒤 End 확정의 하강 에지가 재시도를 죽이면 미반영 기기가 그대로 남는다.
        if (roasting) setSafeOffIssued(false);
        setLastWritten(null);
        setDiverge({ tick: elapsed, ticks: 0 });
        setDivergedLock(false);
    }

    // 외부 개입 판정 (#307) — elapsed를 틱으로 쓰는 이유: liveData 스토어는 값이 같으면
    // 같은 객체를 유지하므로(디듀프) feedback identity로는 "그대로인 이탈"을 못 센다.
    // effect가 아니라 렌더 중 판정인 이유: 확정 커밋에서 아래 판정 effect가 stale
    // active로 이벤트를 한 번 더 써서 개입을 덮는 것(프로파일 교체와 같은 레이스)을 막는다.
    // write는 절대 하지 않는다 — 이탈 시 존중해야 할 값은 기기에 있는 값이다.
    if (elapsed !== diverge.tick) {
        const deviated =
            active &&
            roasting &&
            !heaterPending &&
            lastWritten != null &&
            heaterFeedback != null &&
            Math.abs(heaterFeedback - lastWritten) > DIVERGE_TOLERANCE;
        const ticks = deviated ? diverge.ticks + 1 : 0;
        setDiverge({ tick: elapsed, ticks });
        if (ticks >= DIVERGE_TICKS) {
            setDivergedLock(true);
            setActive(false);
            setStopReason('controlDiverged');
        }
    }

    const stop = useCallback(() => {
        // 수동 개입은 active 여부와 무관하게 safe-off 재시도를 취소한다 —
        // 배출 후 사람이 만진 화력을 재시도가 덮으면 안 된다 (#316)
        setSafeOffIssued(false);
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
        // 재생이 화력을 잡은 채 배출됐다 — zero 정책이면 즉시 끈다 (#316, PID off와
        // 동일 타이밍). stopCause 라벨이 아니라 roastFinished를 보는 이유: "끊김+배출"
        // 커밋에서는 우선순위가 'disconnected'로 밀리는데, 그때도 write는 시도해야
        // 실패가 토스트/Sentry로 관측된다. hold면 아무것도 안 쓴다 — 설정으로 선택된
        // 잔류라 PID hold와 같은 등급의 문서화된 동작이다.
        if (roastFinished && dropBehavior === 'zero') {
            writeHeater(0);
            setSafeOffIssued(true);
        }
    }, [active, stopCause, roastFinished, dropBehavior, writeHeater]);

    // safe-off 재시도 — zero write가 나갔는데 기기가 안 따라오면 다시 쓴다 (#269의
    // PID safe-off와 같은 등급: 아무도 안 보는 로스터에 불이 남는 쪽이 최악이다).
    // 재시도 간격은 unacknowledged 판정 주기(폴링 N회 ≈ 5~10초)가 자연히 만든다 —
    // 매 write가 미반영 카운트를 되돌리므로 tight loop이 될 수 없다.
    useEffect(() => {
        if (!safeOffIssued || !heaterUnacknowledged || !sidecarConnected) return;
        writeHeater(0);
    }, [safeOffIssued, heaterUnacknowledged, sidecarConnected, writeHeater]);

    const toggle = useCallback(() => {
        if (active) {
            setActive(false);
            setStopReason(null); // 사용자가 직접 껐다 — 안내할 사유가 없다
            return;
        }
        if (plan == null || stopCause != null || divergedLock) return;
        setStopReason(null);
        // 꺼져 있던 동안의 수동 개입이 stale 기준으로 남아 즉시 오판하면 안 된다
        setLastWritten(null);
        setDiverge((d) => ({ ...d, ticks: 0 }));
        setActive(true);
    }, [active, plan, stopCause, divergedLock]);

    // 매 온도 샘플 판정. elapsed도 deps에 있어 BT가 정체해도 시간 트리거는 진행한다.
    // stopCause 가드: pidEngaged/unacknowledged는 새 liveBt와 같은 폴링 커밋에 바뀐다 —
    // 위 중지 effect의 setActive(false)는 다음 렌더에나 반영되므로, 같은 커밋의 이
    // effect가 stale active로 한 번 더 쓰는 것을 여기서 막아야 한다.
    useEffect(() => {
        if (!active || stopCause != null || !roasting || liveBt == null || plan == null) return;
        const result = judgeReplay(plan, index, { bt: liveBt, elapsed, afterTurningPoint });
        if (result.nextIndex === index) return;
        setIndex(result.nextIndex);
        if (result.heater != null) {
            writeHeater(result.heater);
            setLastWritten(result.heater);
        }
    }, [active, stopCause, roasting, liveBt, elapsed, afterTurningPoint, plan, index, writeHeater]);

    const nextEvent: ReplayEvent | null = active && plan ? (plan.events[index] ?? null) : null;

    return {
        /** 레퍼런스에 heater 기록이 있고(합성/PID 기록 아님) 쓰기 가능한가 */
        available: plan != null && heaterWritable && sidecarConnected,
        /** 지금 켤 수 없는 상태(PID 점유·이탈 잠금 등) — 토글이 침묵 무시되므로 UI는 disabled로 보여야 한다 */
        blocked: stopCause != null || divergedLock,
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
