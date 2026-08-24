import type { useReplayControl } from '../model/useReplayControl';

interface Props {
    replay: ReturnType<typeof useReplayControl>;
}

/**
 * Replay Assist 패널 (#300) — 레퍼런스 배치의 가스 조작을 BT 도달 시점에 재생.
 *
 * 레퍼런스에 heater 기록이 없거나(합성 프로파일·PID 기록) 히터 쓰기가 불가하면
 * 렌더하지 않는다. 기본 OFF — 명시적 토글로만 시작한다.
 */
export const ReplayControlPanel = ({ replay }: Props) => {
    if (!replay.available) return null;

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
                    className="h-4 w-4 shrink-0 accent-[#111827] dark:accent-[#F2F2F2]"
                />
                <span className="text-[12px] text-secondary">레퍼런스 화력 재생</span>
            </label>

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
