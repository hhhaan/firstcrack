import { useTranslation } from 'react-i18next';
import {
    collapsedReplayTpChrome,
    isReplayTpHold,
    type ReplayTpWaitFacts,
    resolveReplayTpWait,
} from '../lib/replayStatus';
import { REPLAY_OBSERVATION_HOLD_TEXT } from './ReplayControlPanel';

const PID_DOT: Record<string, string> = {
    running: 'bg-emerald-500',
    holding: 'bg-amber-500',
    fault: 'bg-red-500',
};

/** Status dots for the folded rail. Folding hides the editors; it does not drop PID, Replay, or unacked faults. */
export const CollapsedControlStatus = ({
    pidState,
    anyUnacknowledged,
    replay,
}: {
    pidState: string;
    anyUnacknowledged: boolean;
    replay: ReplayTpWaitFacts & { observationHold: boolean };
}) => {
    const { t } = useTranslation();
    const statusDot = PID_DOT[pidState];
    const replayTpWait = resolveReplayTpWait(replay);
    const replayChrome = collapsedReplayTpChrome(replay.active, replayTpWait);
    let holdLabel: string | undefined;
    if (replayChrome === 'waiting') holdLabel = t('activeRoast.replay.tp.collapsedWaiting');
    else if (replayChrome === 'fallback') holdLabel = t('activeRoast.replay.tp.collapsedFallback');

    return (
        <>
            {statusDot && (
                <span
                    role="img"
                    className={`h-2 w-2 rounded-full ${statusDot}`}
                    title={`PID ${pidState}`}
                    aria-label={`PID ${pidState}`}
                />
            )}
            {/* 접혀도 Replay가 히터를 잡고 있다는 표시는 보여야 한다 (#300). 대기/폴백은 정상 재생과 구분. */}
            {replayChrome === 'running' && (
                <span
                    role="img"
                    className={`h-2 w-2 rounded-full ${replay.observationHold ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    title={replay.observationHold ? REPLAY_OBSERVATION_HOLD_TEXT : 'Replay 재생 중'}
                    aria-label={replay.observationHold ? REPLAY_OBSERVATION_HOLD_TEXT : 'Replay 재생 중'}
                />
            )}
            {isReplayTpHold(replayChrome) && (
                <span
                    role="img"
                    className="h-2 w-2 rounded-full bg-amber-500"
                    title={holdLabel}
                    aria-label={holdLabel}
                />
            )}
            {/* 접혀도 미반영 경고는 보여야 한다 — 원격 제어 거부를 모른 채 지나칠 수 있다 (#269) */}
            {anyUnacknowledged && (
                <span
                    role="img"
                    className="h-2 w-2 rounded-full bg-red-500"
                    title="기기가 명령을 반영하지 않았습니다"
                    aria-label="기기가 명령을 반영하지 않았습니다"
                />
            )}
        </>
    );
};
