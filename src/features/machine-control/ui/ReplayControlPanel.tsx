import type { ReplayStopReason, useReplayControl } from '../model/useReplayControl';

interface Props {
    replay: ReturnType<typeof useReplayControl>;
}

// 'finished'는 배치 종료라 안내하지 않는다 — 맵에 없으면 렌더 생략
const STOP_REASON_TEXT: Partial<Record<ReplayStopReason, string>> = {
    disconnected: '연결 끊김으로 재생 중지',
    pid: 'PID 개입으로 재생 중지',
    unacknowledged: '명령 미반영으로 재생 중지',
    unwritable: '히터 제어 불가로 재생 중지',
    manual: '수동 조작으로 재생 중지',
    profileChanged: '프로파일 변경으로 재생 중지',
};

/**
 * Replay Assist 패널 (#300) — 레퍼런스 배치의 가스 조작을 BT 도달 시점에 재생.
 *
 * 레퍼런스에 heater 기록이 없거나(합성 프로파일·PID 기록) 히터 쓰기가 불가하면
 * 렌더하지 않는다. 기본 OFF — 명시적 토글로만 시작한다.
 */
export const ReplayControlPanel = ({ replay }: Props) => {
    const stopText = replay.stopReason ? STOP_REASON_TEXT[replay.stopReason] : undefined;
    // 중지 사유가 있으면 available이 무너져도(연결 끊김 등) 패널을 유지한다 —
    // 숨겨버리면 "왜 꺼졌는지"를 보여줄 자리가 사라진다
    if (!replay.available && !stopText) return null;

    return (
        <div className="flex shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Replay</span>
                <span className={`text-[11px] font-medium ${replay.active ? 'text-emerald-500' : 'text-muted'}`}>
                    {replay.active ? 'On' : 'Off'}
                </span>
            </div>

            <label className="flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={replay.active}
                    onChange={replay.toggle}
                    disabled={!replay.available}
                    className="h-4 w-4 shrink-0 accent-[#111827] dark:accent-[#F2F2F2]"
                />
                <span className="text-[12px] text-secondary">레퍼런스 화력 재생</span>
            </label>

            {!replay.active && stopText && <p className="text-[11px] leading-snug text-red-500">{stopText}</p>}

            {replay.active &&
                (replay.nextEvent ? (
                    <p className="font-mono text-[11px] text-muted">
                        다음: BT {Math.round(replay.nextEvent.bt)}°C → {Math.round(replay.nextEvent.heater)}%
                    </p>
                ) : (
                    <p className="text-[11px] text-muted">모든 이벤트 재생 완료</p>
                ))}

            {replay.active && (
                <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-500">
                    자리를 비우지 마세요. 슬라이더를 조작하면 이번 배치의 재생이 중지됩니다. 기센은 본체 Auto를 Manual로
                    두어야 합니다.
                </p>
            )}
        </div>
    );
};
