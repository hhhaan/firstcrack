import type { ControlLimit } from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { useRef } from 'react';
import type { ControlRole } from '../lib/controlSender';
import { percentTicks, showLiveFollow, snapPercent, stepPercent } from '../lib/snapPercent';
import { useHoldRepeat } from '../lib/useHoldRepeat';

/** 훅의 CONVERGE_TOLERANCE와 같음 — 라이브 라인 표시만 여기서 본다 */
const CONVERGE_TOLERANCE = 1;

interface Props {
    limit: ControlLimit;
    value: number | undefined;
    feedback: number | null;
    unacknowledged: boolean;
    disabled: boolean;
    lockedNote?: string;
    unsupported?: boolean;
    sending?: boolean;
    onChange: (role: ControlRole, value: number) => void;
    onCommit: () => void;
}

const stepBtnCls =
    'flex h-6 min-w-7 items-center justify-center rounded-md border border-black/10 bg-transparent px-1.5 font-mono text-[11px] font-medium text-secondary disabled:cursor-not-allowed dark:border-[#585d61]';

/**
 * % 히터 A′ — 세로 5% 눈금. 노란 채움·큰 숫자·선택 눈금은 desired,
 * 가로선·기기 n은 live (따라오면 muted, 미반영이면 red).
 */
export const HeaterScale = ({
    limit,
    value,
    feedback,
    unacknowledged,
    disabled,
    lockedNote,
    unsupported = false,
    sending = false,
    onChange,
    onCommit,
}: Props) => {
    const min = limit.min ?? 0;
    const max = limit.max ?? 100;
    const unit = limit.unit || '%';
    const current = unsupported ? min : (value ?? feedback ?? min);
    const live = !unsupported && showLiveFollow(value, feedback, CONVERGE_TOLERANCE);
    const ticks = percentTicks(min, max);
    const locked = disabled || unsupported || sending;
    const span = max - min || 1;
    const fillPct = Math.min(100, Math.max(0, ((current - min) / span) * 100));
    const livePct = feedback != null ? Math.min(100, Math.max(0, ((feedback - min) / span) * 100)) : null;
    const selected = snapPercent(current, min, max);

    const commit = (next: number) => {
        if (locked) return;
        onChange('heater', snapPercent(next, min, max));
        onCommit();
    };

    const valueRef = useRef(current);
    const bump = (delta: number) => {
        if (locked) return;
        const next = stepPercent(valueRef.current, delta, min, max);
        if (next === valueRef.current) return;
        valueRef.current = next;
        onChange('heater', next);
        onCommit();
    };
    const plusHold = useHoldRepeat(() => bump(5), locked);
    const minusHold = useHoldRepeat(() => bump(-5), locked);
    const wrapHold = (hold: ReturnType<typeof useHoldRepeat>) => ({
        ...hold,
        onPointerDown: () => {
            valueRef.current = current;
            hold.onPointerDown();
        },
        onClick: () => {
            valueRef.current = current;
            hold.onClick();
        },
    });

    return (
        <div className={cn('flex min-h-24 min-w-0 flex-1 flex-col gap-1.5', (disabled || sending) && 'opacity-40')}>
            <div className="flex items-center justify-between gap-1">
                <button
                    type="button"
                    data-step="-5"
                    disabled={locked}
                    aria-label="Heater minus 5"
                    className={stepBtnCls}
                    {...wrapHold(minusHold)}
                >
                    −5
                </button>
                <div className="flex flex-col items-center">
                    <span className="font-mono text-[13px] font-semibold text-primary">
                        {unsupported ? '—' : `${Math.round(current)}${unit}`}
                    </span>
                    {live && feedback != null && (
                        <span className={`font-mono text-[10px] ${unacknowledged ? 'text-red-500' : 'text-muted'}`}>
                            기기 {Math.round(feedback)}
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    data-step="5"
                    disabled={locked}
                    aria-label="Heater plus 5"
                    className={stepBtnCls}
                    {...wrapHold(plusHold)}
                >
                    +5
                </button>
            </div>

            <div
                role="slider"
                tabIndex={locked ? -1 : 0}
                aria-label={unsupported ? 'Heater not supported' : 'Heater setpoint'}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={Math.round(current)}
                aria-disabled={locked}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        commit(stepPercent(current, 5, min, max));
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        commit(stepPercent(current, -5, min, max));
                    }
                }}
                className="relative flex min-h-0 flex-1 flex-col outline-none"
            >
                <div className="pointer-events-none absolute inset-x-8 inset-y-0 rounded-sm bg-surface" />
                <div
                    className="pointer-events-none absolute inset-x-8 bottom-0 rounded-sm bg-(--color-control-heat-area)"
                    style={{ height: `${fillPct}%` }}
                />
                {live && livePct != null && (
                    <span
                        data-live-line
                        className={`pointer-events-none absolute inset-x-6 h-0.5 rounded-full ${
                            unacknowledged ? 'bg-red-500' : 'bg-muted'
                        }`}
                        style={{ bottom: `${livePct}%` }}
                    />
                )}
                <div className="relative flex min-h-0 flex-1 flex-col-reverse justify-between">
                    {ticks.map((tick) => {
                        const labeled = tick % 10 === 0;
                        const isSelected = tick === selected;
                        return (
                            <button
                                key={tick}
                                type="button"
                                data-tick={tick}
                                disabled={locked}
                                aria-label={`Heater ${tick}${unit}`}
                                aria-pressed={isSelected}
                                onClick={() => commit(tick)}
                                className="flex h-0 min-h-0 flex-1 cursor-pointer items-center gap-1 border-none bg-transparent px-0 disabled:cursor-not-allowed"
                            >
                                <span
                                    className={cn(
                                        'w-6 shrink-0 text-right font-mono text-[10px] leading-none',
                                        labeled
                                            ? isSelected
                                                ? 'font-semibold text-(--color-control-heat)'
                                                : 'text-secondary'
                                            : 'text-transparent',
                                    )}
                                >
                                    {labeled ? tick : ''}
                                </span>
                                <span
                                    className={cn(
                                        'rounded-full',
                                        isSelected
                                            ? 'h-0.5 flex-1 bg-(--color-control-heat)'
                                            : labeled
                                              ? 'h-px flex-1 bg-border'
                                              : 'h-px w-3 bg-border-subtle',
                                    )}
                                />
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex h-7 flex-col items-center">
                <span className="text-[11px] font-medium text-secondary">Heater</span>
                {lockedNote && <span className="text-[10px] leading-tight text-muted">{lockedNote}</span>}
            </div>
        </div>
    );
};
