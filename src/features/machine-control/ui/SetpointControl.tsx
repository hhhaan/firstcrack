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
    /** 지시 후 오래 지나도 머신이 안 따라옴 — 명령이 먹지 않았을 가능성 */
    unacknowledged: boolean;
    disabled: boolean;
    onChange: (role: ControlRole, value: number) => void;
    onCommit: () => void;
}

/**
 * setpoint 하나를 조작하는 슬라이더.
 *
 * range 입력은 네이티브 요소를 그대로 쓴다 — 키보드 조작·접근성이 기본으로 따라온다.
 */
export const SetpointControl = ({
    role,
    limit,
    value,
    feedback,
    unacknowledged,
    disabled,
    onChange,
    onCommit,
}: Props) => {
    const min = limit.min ?? 0;
    const max = limit.max ?? 100;
    const unit = limit.unit ?? '';
    // 지시가 남아 있으면(=머신이 아직 안 따라옴) 그 값을, 아니면 머신 실측을 보여준다.
    // 머신이 따라온 뒤에는 지시가 지워지므로 본체 조작반에서 돌린 값도 여기 반영된다.
    const pending = value != null;
    const current = value ?? feedback ?? min;

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-medium text-secondary">{ROLE_LABEL[role]}</span>
                <span className="font-mono text-[12px] text-primary">
                    {Math.round(current)}
                    {unit}
                    {/* 지시 중에는 머신 실측을 함께 보여준다 — 따라오고 있는지 눈으로 확인 */}
                    {pending && feedback != null && (
                        <span className={`ml-1 ${unacknowledged ? 'text-red-500' : 'text-muted'}`}>
                            (기기 {Math.round(feedback)})
                        </span>
                    )}
                </span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={1}
                value={current}
                disabled={disabled}
                aria-label={`${ROLE_LABEL[role]} setpoint`}
                onChange={(e) => onChange(role, Number(e.target.value))}
                onPointerUp={onCommit}
                onKeyUp={onCommit}
                className="w-full accent-[#111827] disabled:opacity-40 dark:accent-[#F2F2F2]"
            />
            {unacknowledged && (
                <p className="text-[11px] leading-snug text-red-500">
                    기기가 명령을 반영하지 않았습니다. 조작반이 원격 제어를 허용하는지 확인하세요.
                </p>
            )}
        </div>
    );
};
