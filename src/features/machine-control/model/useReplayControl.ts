import { useCallback, useEffect, useMemo, useState } from 'react';
import { extractReplayEvents, judgeReplay, type ReplayEvent, type ReplayPoint } from '../lib/replay';

export interface ReplayControlInputs {
    /** 타겟 프로파일 커브 (charge 기준 상대 시간) — 없으면 Replay 비활성 */
    referencePoints: ReplayPoint[] | null;
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
 * Replay Assist 수명 관리 (#300). 판정은 lib/replay의 순수 함수가 하고,
 * 이 훅은 켜기/끄기와 안전 중지만 담당한다.
 *
 * 기본 OFF, 명시적 토글로만 시작. DROP·연결 끊김·PID 개입·수동 슬라이더 조작·
 * 쓰기 미반영 중 하나라도 걸리면 그 배치의 재생은 끝이다 — 재개하지 않는다.
 * (재개는 "어디부터"라는 새 문제를 만든다. Cropster도 배치 단위로 죽인다.)
 */
export const useReplayControl = ({
    referencePoints,
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
        () => (referencePoints && referencePoints.length > 0 ? extractReplayEvents(referencePoints) : null),
        [referencePoints],
    );

    const [active, setActive] = useState(false);
    const [index, setIndex] = useState(0);

    const stop = useCallback(() => setActive(false), []);

    // 레퍼런스가 바뀌면 진행 중인 재생은 무효 — 옛 인덱스로 새 계획을 재생하면 안 된다
    // biome-ignore lint/correctness/useExhaustiveDependencies: plan 교체 감지가 목적인 의도적 dep
    useEffect(() => {
        setActive(false);
        setIndex(0);
    }, [plan]);

    // 안전 중지 — 조건이 하나라도 성립하는 동안 active로 남아 있으면 안 된다
    const mustStop = pidEngaged || roastFinished || !sidecarConnected || !heaterWritable || heaterUnacknowledged;
    useEffect(() => {
        if (active && mustStop) setActive(false);
    }, [active, mustStop]);

    const toggle = useCallback(() => {
        setActive((on) => {
            if (on) return false;
            if (plan == null || mustStop) return false;
            setIndex(0); // 켤 때마다 처음부터 — 이미 지난 이벤트는 첫 판정이 최신 값 하나로 따라잡는다
            return true;
        });
    }, [plan, mustStop]);

    // 매 온도 샘플 판정. elapsed도 deps에 있어 BT가 정체해도 시간 트리거는 진행한다.
    useEffect(() => {
        if (!active || !roasting || liveBt == null || plan == null) return;
        const result = judgeReplay(plan, index, { bt: liveBt, elapsed, afterTurningPoint });
        if (result.nextIndex === index) return;
        setIndex(result.nextIndex);
        if (result.heater != null) writeHeater(result.heater);
    }, [active, roasting, liveBt, elapsed, afterTurningPoint, plan, index, writeHeater]);

    const nextEvent: ReplayEvent | null = active && plan ? (plan.events[index] ?? null) : null;

    return {
        /** 레퍼런스에 heater 기록이 있고(합성/PID 기록 아님) 쓰기 가능한가 */
        available: plan != null && heaterWritable && sidecarConnected,
        active,
        /** 다음에 발화할 이벤트 — UI 미리보기용. 다 소진했으면 null */
        nextEvent,
        toggle,
        /** 수동 개입 시 부모가 부른다 — 슬라이더 onChange에서, Replay 자신의 쓰기 경로에서는 부르지 않는다 */
        stop,
    };
};
