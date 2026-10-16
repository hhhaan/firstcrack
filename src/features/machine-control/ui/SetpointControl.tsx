import type { ControlLimit } from '@entities/machine';
import type { ControlRole } from '../lib/controlSender';

const ROLE_LABEL: Record<ControlRole, string> = {
    heater: 'Heater',
    fan: 'Fan',
    drum: 'Drum',
};

interface Props {
    role: ControlRole;
    limit: ControlLimit;
    /** 지시했지만 머신이 아직 따라오지 않은 값. 따라오면 훅이 지워 undefined가 된다. */
    value: number | undefined;
    /** 머신이 실제로 보고하는 현재값 (폴링 결과) */
    feedback: number | null;
    disabled: boolean;
    /** 왜 잠겼는지 (예: PID가 잡고 있음, 머신 미지원). 없으면 표시하지 않는다. */
    lockedNote?: string;
    /** 머신에 이 채널이 없음 — 값 대신 대시, fader는 disabled. */
    unsupported?: boolean;
    onChange: (role: ControlRole, value: number) => void;
    onCommit: () => void;
}

/**
 * setpoint 하나를 조작하는 세로 fader.
 *
 * range 입력은 네이티브 요소를 그대로 쓴다 — 키보드 조작·접근성이 기본으로 따라온다.
 * 세로화도 CSS만으로 한다 (`writing-mode: vertical-lr` + `direction: rtl`로 min을 아래에).
 * `-webkit-appearance: slider-vertical`은 writing-mode를 모르는 구형 WebKit용 fallback.
 *
 * 값/라벨 블록의 높이를 고정해 채널 간 트랙 시작점을 맞춘다.
 */
export const SetpointControl = ({
    role,
    limit,
    value,
    feedback,
    disabled,
    lockedNote,
    unsupported = false,
    onChange,
    onCommit,
}: Props) => {
    const min = limit.min ?? 0;
    const max = limit.max ?? 100;
    const unit = limit.unit ?? '';
    // 지시가 남아 있으면(=머신이 아직 안 따라옴) 그 값을, 아니면 머신 실측을 보여준다.
    // 머신이 따라온 뒤에는 지시가 지워지므로 본체 조작반에서 돌린 값도 여기 반영된다.
    const pending = !unsupported && value != null;
    const current = unsupported ? min : (value ?? feedback ?? min);
    // 지시와 실측이 벌어져 있는 동안만 트랙에 실측 눈금을 띄운다. 머신이 따라오면
    // 눈금이 썸 쪽으로 미끄러져 붙는다 — "명령이 먹고 있는가"를 숫자 대신 거리로 보여준다.
    const ghostPct =
        pending && feedback != null && Math.abs(feedback - current) > 1
            ? Math.min(100, Math.max(0, ((feedback - min) / (max - min || 1)) * 100))
            : null;

    return (
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex h-7 flex-col items-center justify-end">
                <span className="font-mono text-[13px] font-semibold text-primary">
                    {unsupported ? '—' : `${Math.round(current)}${unit}`}
                </span>
                {/* 지시 중에는 머신 실측을 함께 보여준다 — 따라오고 있는지 눈으로 확인 */}
                {pending && feedback != null && (
                    <span className="font-mono text-[10px] text-muted">기기 {Math.round(feedback)}</span>
                )}
            </div>
            <div className="relative flex min-h-0 w-full flex-1 justify-center">
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={1}
                    value={current}
                    disabled={disabled || unsupported}
                    aria-label={unsupported ? `${ROLE_LABEL[role]} not supported` : `${ROLE_LABEL[role]} setpoint`}
                    onChange={(e) => onChange(role, Number(e.target.value))}
                    onPointerUp={onCommit}
                    // 포인터를 요소 밖에서 떼거나 드래그가 취소돼도 마지막 값은 나가야 한다.
                    // WKWebView는 implicit pointer capture 보장이 약해 cancel/blur도 받는다.
                    // AT(VoiceOver 등)는 pointer/key 이벤트 없이 값만 바꾸므로 blur가 마지막 그물이다.
                    onLostPointerCapture={onCommit}
                    onPointerCancel={onCommit}
                    onBlur={onCommit}
                    onKeyUp={onCommit}
                    className="min-h-0 w-6 flex-1 cursor-pointer accent-[#111827] disabled:cursor-not-allowed disabled:opacity-40 dark:accent-[#F2F2F2] [-webkit-appearance:slider-vertical] [direction:rtl] [writing-mode:vertical-lr]"
                />
                {/* ponytail: inset-y-2.5는 썸 반지름(≈10px)만큼의 여백 근사. 눈금은 지표라 픽셀 정합까지는 불필요 */}
                {ghostPct != null && (
                    <div className="pointer-events-none absolute inset-y-2.5 left-1/2 w-3.5 -translate-x-1/2">
                        <span
                            className="absolute left-0 h-0.5 w-full rounded-full bg-muted transition-[bottom] duration-500 ease-out"
                            style={{ bottom: `${ghostPct}%` }}
                        />
                    </div>
                )}
            </div>
            <div className="flex h-7 flex-col items-center">
                <span className="text-[11px] font-medium text-secondary">{ROLE_LABEL[role]}</span>
                {lockedNote && <span className="text-[10px] leading-tight text-muted">{lockedNote}</span>}
            </div>
        </div>
    );
};
