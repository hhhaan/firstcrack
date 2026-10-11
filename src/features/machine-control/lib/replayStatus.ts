import { eventTrigger, type ReplayEvent } from './replay';

/** TP 대기 UI — 다음 이벤트가 BT일 때만. TIME은 TP 게이트와 무관하다. */
export type ReplayTpWaitState = 'waiting' | 'fallback' | 'detected' | null;

export type ReplayTpWaitFacts = {
    active: boolean;
    nextEvent: ReplayEvent | null;
    /** plan.tpTime — 명시적 기준이 없는 행의 TP 전후 분류에 사용 */
    tpTime: number | null;
    confirmedTurningPoint: { fallback?: boolean } | null;
};

/**
 * 다음이 BT이고 실제 TP가 없으면 waiting. fallback은 실감지와 구분한다.
 * TIME에는 TP 대기 UI를 쓰지 않는다.
 */
export const resolveReplayTpWait = ({
    active,
    nextEvent,
    tpTime,
    confirmedTurningPoint,
}: ReplayTpWaitFacts): ReplayTpWaitState => {
    if (!active || nextEvent == null || tpTime == null) return null;
    if (eventTrigger(nextEvent, tpTime) === 'time') return null;
    if (confirmedTurningPoint == null) return 'waiting';
    if (confirmedTurningPoint.fallback) return 'fallback';
    return 'detected';
};

/** 접힌 레일 Replay 점. 대기/폴백은 정상 재생과 다른 톤. */
export const collapsedReplayTpChrome = (
    active: boolean,
    tpWait: ReplayTpWaitState,
): 'running' | 'waiting' | 'fallback' | null => {
    if (!active) return null;
    if (tpWait === 'waiting' || tpWait === 'fallback') return tpWait;
    return 'running';
};

export const isReplayTpHold = (chrome: ReturnType<typeof collapsedReplayTpChrome>): chrome is 'waiting' | 'fallback' =>
    chrome === 'waiting' || chrome === 'fallback';
