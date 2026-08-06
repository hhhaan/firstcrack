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
    /** 사용자가 지시한 값. 아직 지시가 없으면 머신에서 읽은 현재값을 보여준다. */
    value: number | undefined;
    /** 머신이 실제로 보고하는 현재값 (폴링 결과) */
    feedback: number | null;
    disabled: boolean;
    onChange: (role: ControlRole, value: number) => void;
    onCommit: () => void;
}

/**
 * setpoint 하나를 조작하는 슬라이더.
 *
 * range 입력은 네이티브 요소를 그대로 쓴다 — 키보드 조작·접근성이 기본으로 따라온다.
 */
export const SetpointControl = ({ role, limit, value, feedback, disabled, onChange, onCommit }: Props) => {
    const min = limit.min ?? 0;
    const max = limit.max ?? 100;
    const current = value ?? feedback ?? min;
    const unit = limit.unit ?? '';

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-medium text-secondary">{ROLE_LABEL[role]}</span>
                <span className="font-mono text-[12px] text-primary">
                    {Math.round(current)}
                    {unit}
                    {/* 지시값과 머신 보고값이 다르면 아직 반영 전이거나 머신이 따라오는 중 */}
                    {value != null && feedback != null && Math.round(value) !== Math.round(feedback) && (
                        <span className="ml-1 text-muted">({Math.round(feedback)})</span>
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
        </div>
    );
};
