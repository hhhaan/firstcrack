import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractReplayEvents, judgeReplay, type ReplayEvent, type ReplayPoint } from '../lib/replay';

export interface ReplayControlInputs {
    /** 타겟 프로파일 커브 (charge 기준 상대 시간) — 없으면 Replay 비활성 */
    referencePoints: ReplayPoint[] | null;
    /**
     * 레퍼런스가 다른 기종에서 기록됐다 — Replay는 같은 기기만 재생한다. 히터 스케일이
     * 다르면(WxA coarse 0~10 스텝 vs % 기종) 전 이벤트가 clamp로 최대/최소 화력에 붙는다.
     * 양쪽 키가 모두 있고 다를 때만 true — 마이그레이션 이전 프로파일(null)은 막지 않는다.
     */
    referenceMachineMismatch: boolean;
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
    /**
     * 사이드카 재연결 대기 중 — 이 동안 실측은 동결되는데 elapsed는 호스트 시계라
     * 계속 흘러, 같은 샘플 하나로 "지속 이탈"을 확정할 수 있다. 카운트를 멈춘다.
     */
    reconnecting: boolean;
    /** resolve false = /control 실패(timeout·409·502) — Replay는 그 이벤트를 소진하지 않는다 (#312) */
    writeHeater: (value: number) => Promise<boolean>;
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
    | 'controlDiverged'
    | 'timingGap'
    | 'writeFailed';

/**
 * 마지막 확정 명령에서 실측이 이만큼 **초과** 이탈하면 외부 개입 후보로 센다.
 * CONVERGE_TOLERANCE + 1로 유도된 값: 수렴 잔차(1) + 리드백 노이즈 ±1이 겹친 최악
 * 정상치가 정확히 2라 초과(>) 판정이어야 오탐이 없다. 수렴 허용치를 머신별로
 * 바꾸게 되면 이 값도 독립 상수가 아니라 거기서 유도해야 경계 불변식이 유지된다.
 * ponytail: 고정 deadband — 아날로그 duty 리드백이 더 시끄러운 기종이 나오면 머신별 설정으로.
 */
const DIVERGE_TOLERANCE = 2;
/** 이탈이 이만큼의 elapsed 틱(≈1초) 연속이어야 확정 — 순간 스파이크 제외 */
const DIVERGE_TICKS = 3;
/**
 * 연속 렌더 사이 elapsed가 이만큼 **초과** 뛰면 JS가 멈췄던 것으로 본다 (#313).
 * elapsed는 호스트 시계에서 유도되지만 갱신은 webview 타이머·폴링이 하므로, 창
 * 최소화·App Nap·슬립으로 webview가 스로틀되면 멈췄다가 복귀 때 한 번에 점프한다.
 * 그동안 실기는 마지막 화력으로 계속 돌았고 UI만 Replay On이었다 — fail-closed로
 * 멈추고 사람이 확인 후 다시 켠다. 정상 틱은 1초(지터 2초), 최대 폴링 주기 1초.
 * ponytail: sidecar heartbeat로 판정을 옮기면(#308) 이 감지는 그쪽 책임이 된다.
 */
const SAMPLE_GAP_LIMIT_S = 5;

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
    referenceMachineMismatch,
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
    reconnecting,
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
    /** 직전 렌더의 elapsed — 타이밍 갭 감지 기준 (#313) */
    const [prevElapsed, setPrevElapsed] = useState(elapsed);
    /**
     * 이벤트 write가 /control 응답 대기 중 — 그동안 판정을 멈춰 같은 이벤트를 두 번 쓰지
     * 않는다 (#312). 응답 세대: 배치·프로파일 경계를 넘어 도착한 늦은 응답은 무시한다 —
     * 리셋된 index를 옛 nextIndex로 덮으면 안 된다.
     */
    const [writing, setWriting] = useState(false);
    const writeGenRef = useRef(0);

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
        // lookback 자동 차지는 origin을 과거로 잡아 elapsed가 0보다 크게 시작한다 —
        // 이전 배치 기준으로 재면 차지 직후 오중지된다.
        setPrevElapsed(elapsed);
    }

    // 배치·프로파일 경계에서 write 세대를 올린다 — 위 렌더 중 리셋과 같은 커밋에 실행되므로
    // 경계 전에 나간 write의 응답은 반드시 새 세대를 본다. (렌더 중 ref 갱신은 lint 금지)
    // biome-ignore lint/correctness/useExhaustiveDependencies: plan·roasting은 트리거이지 읽는 값이 아니다
    useEffect(() => {
        writeGenRef.current += 1;
    }, [plan, roasting]);

    // 타이밍 갭 판정 (#313) — 렌더 중인 이유는 profileChanged와 같다: 복귀 커밋에서
    // 아래 판정 effect가 stale active로 밀린 이벤트를 한 번 더 쓰는 것을 막는다.
    // 복귀 후 catch-up write는 하지 않는다 — 그동안의 실기 상태를 모른다.
    if (elapsed !== prevElapsed) {
        setPrevElapsed(elapsed);
        if (active && roasting && elapsed - prevElapsed > SAMPLE_GAP_LIMIT_S) {
            setActive(false);
            setStopReason('timingGap');
        }
    }

    // 외부 개입 판정 (#307) — elapsed를 틱으로 쓰는 이유: liveData 스토어는 값이 같으면
    // 같은 객체를 유지하므로(디듀프) feedback identity로는 "그대로인 이탈"을 못 센다.
    // effect가 아니라 렌더 중 판정인 이유: 확정 커밋에서 아래 판정 effect가 stale
    // active로 이벤트를 한 번 더 써서 개입을 덮는 것(프로파일 교체와 같은 레이스)을 막는다.
    // write는 절대 하지 않는다 — 이탈 시 존중해야 할 값은 기기에 있는 값이다.
    // reconnecting 동안은 카운트 일시정지(리셋 아님) — 동결된 실측을 elapsed 틱으로
    // 여러 번 세면 1샘플로 확정된다. 복구 후 새 샘플부터 이어 센다.
    if (elapsed !== diverge.tick && !reconnecting) {
        const deviated =
            active &&
            roasting &&
            !heaterPending &&
            lastWritten != null &&
            heaterFeedback != null &&
            Math.abs(heaterFeedback - lastWritten) > DIVERGE_TOLERANCE;
        const ticks = deviated ? diverge.ticks + 1 : 0;
        // 카운터가 0→0이면 setState 생략 — 유휴 중 매초 여분 렌더를 만들지 않는다.
        // tick이 stale해져도 무해하다: 다음 이탈의 첫 렌더에서 1부터 정상 카운트된다.
        if (ticks !== 0 || diverge.ticks !== 0) setDiverge({ tick: elapsed, ticks });
        // 확정 시 중지만 한다 — 배치 잠금은 두지 않는다. 재개는 사람이 토글해야만
        // 가능하고, 토글이 lastWritten을 리셋해 감지가 즉시 재무장되므로 원인이
        // 지속되면(인터락·타 소프트웨어) 다음 이벤트 write 후 ~3틱 안에 다시 걸린다.
        // 앱 슬라이더 개입(manual)과 처벌을 다르게 둘 이유가 없다.
        if (ticks >= DIVERGE_TICKS) {
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
            void writeHeater(0);
            setSafeOffIssued(true);
        }
    }, [active, stopCause, roastFinished, dropBehavior, writeHeater]);

    // safe-off 재시도 — zero write가 나갔는데 기기가 안 따라오면 다시 쓴다 (#269의
    // PID safe-off와 같은 등급: 아무도 안 보는 로스터에 불이 남는 쪽이 최악이다).
    // 재시도 간격은 unacknowledged 판정 주기(폴링 N회 ≈ 5~10초)가 자연히 만든다 —
    // 매 write가 미반영 카운트를 되돌리므로 tight loop이 될 수 없다.
    useEffect(() => {
        if (!safeOffIssued || !heaterUnacknowledged || !sidecarConnected) return;
        void writeHeater(0);
    }, [safeOffIssued, heaterUnacknowledged, sidecarConnected, writeHeater]);

    const toggle = useCallback(() => {
        if (active) {
            setActive(false);
            setStopReason(null); // 사용자가 직접 껐다 — 안내할 사유가 없다
            return;
        }
        if (plan == null || referenceMachineMismatch || stopCause != null) return;
        setStopReason(null);
        // 꺼져 있던 동안의 수동 개입이 stale 기준으로 남아 즉시 오판하면 안 된다
        setLastWritten(null);
        setDiverge((d) => ({ ...d, ticks: 0 }));
        setActive(true);
    }, [active, plan, referenceMachineMismatch, stopCause]);

    // 매 온도 샘플 판정. elapsed도 deps에 있어 BT가 정체해도 시간 트리거는 진행한다.
    // stopCause 가드: pidEngaged/unacknowledged는 새 liveBt와 같은 폴링 커밋에 바뀐다 —
    // 위 중지 effect의 setActive(false)는 다음 렌더에나 반영되므로, 같은 커밋의 이
    // effect가 stale active로 한 번 더 쓰는 것을 여기서 막아야 한다.
    // reconnecting 가드: 링크 복구 대기 중에도 sidecarConnected는 true로 유지되고(세션 보존)
    // elapsed는 호스트 시계라 계속 흘러, 시간축 이벤트가 409로 실패하면서 인덱스만 소비된다.
    // 여기서 멈추면 복구 후 judgeReplay가 밀린 이벤트를 한 번에 따라잡는다.
    useEffect(() => {
        if (!active || stopCause != null || !roasting || reconnecting || liveBt == null || plan == null) return;
        // 이탈 후보 확정 대기 중(1~2틱)에는 이벤트를 쓰지 않는다 — 여기서 쓰면 실기
        // 개입을 덮는 동시에 lastWritten 갱신·pending으로 판정까지 리셋돼, #307이
        // 막으려던 경로가 확정 창 안에서 재현된다. 노이즈로 판명되면(카운터 0 복귀)
        // 이 effect가 다시 실행되고 judgeReplay가 밀린 이벤트를 한 번에 따라잡는다.
        if (diverge.ticks > 0 || writing) return;
        const result = judgeReplay(plan, index, { bt: liveBt, elapsed, afterTurningPoint });
        if (result.nextIndex === index || result.heater == null) return;
        // 성공을 확인한 뒤에만 index를 전진한다 — 실패한 이벤트는 남겨 두고 fail-closed로
        // 멈춘다. 자동 재시도는 없다: 물리 제어 실패는 사람이 기기를 보고 다시 켠다.
        const heater = result.heater;
        const gen = writeGenRef.current;
        setWriting(true);
        void writeHeater(heater).then((ok) => {
            setWriting(false);
            if (gen !== writeGenRef.current) return;
            if (ok) {
                setIndex(result.nextIndex);
                setLastWritten(heater);
                return;
            }
            setActive(false);
            setStopReason('writeFailed');
        });
    }, [
        active,
        stopCause,
        roasting,
        reconnecting,
        liveBt,
        elapsed,
        afterTurningPoint,
        plan,
        index,
        diverge.ticks,
        writing,
        writeHeater,
    ]);

    const nextEvent: ReplayEvent | null = active && plan ? (plan.events[index] ?? null) : null;

    return {
        /** 레퍼런스에 heater 기록이 있고(합성/PID 기록 아님) 같은 기기이며 쓰기 가능한가 */
        available: plan != null && !referenceMachineMismatch && heaterWritable && sidecarConnected,
        /** 다른 기종 기록 — UI 힌트 분리용 */
        machineMismatch: referenceMachineMismatch,
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
