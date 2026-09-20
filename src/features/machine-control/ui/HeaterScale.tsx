import type { ControlLimit } from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { useEffect, useRef } from 'react';
import { CONVERGE_TOLERANCE, type ControlRole } from '../lib/controlSender';
import { percentTicks, showLiveFollow, snapPercent, stepPercent } from '../lib/snapPercent';
import { useHoldRepeat } from '../lib/useHoldRepeat';

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
 * % 히터 A′ — 세로 5% 눈금. 10은 왼쪽, 5·15·25는 오른쪽.
 * 왼쪽 10단위는 숫자만 탭. 바·오른쪽 5단위는 행 탭.
 * 노란 채움·큰 숫자·선택 눈금은 desired, 가로선·기기 n은 live.
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
    const blocked = disabled || unsupported;
    const span = max - min || 1;
    const fillPct = Math.min(100, Math.max(0, ((current - min) / span) * 100));
    const livePct = feedback != null ? Math.min(100, Math.max(0, ((feedback - min) / span) * 100)) : null;
    const selected = snapPercent(current, min, max);
    const valueRef = useRef(current);
    useEffect(() => {
        valueRef.current = current;
    }, [current]);

    const commit = (next: number) => {
        if (blocked) return;
        const snapped = snapPercent(next, min, max);
        valueRef.current = snapped;
        onChange('heater', snapped);
        onCommit();
    };

    const plusHold = useHoldRepeat(
        () => {
            if (blocked) return;
            const next = stepPercent(valueRef.current, 5, min, max);
            if (next === valueRef.current) return;
            valueRef.current = next;
            onChange('heater', next);
            onCommit();
        },
        blocked,
        () => {
            valueRef.current = current;
        },
    );
    const minusHold = useHoldRepeat(
        () => {
            if (blocked) return;
            const next = stepPercent(valueRef.current, -5, min, max);
            if (next === valueRef.current) return;
            valueRef.current = next;
            onChange('heater', next);
            onCommit();
        },
        blocked,
        () => {
            valueRef.current = current;
        },
    );

    return (
        <div className={cn('flex min-h-24 min-w-0 flex-1 flex-col gap-1.5', (disabled || sending) && 'opacity-40')}>
            <div className="flex items-center justify-between gap-1">
                <button
                    type="button"
                    data-step="-5"
                    disabled={blocked}
                    aria-label="Heater minus 5"
                    className={stepBtnCls}
                    {...minusHold}
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
                    disabled={blocked}
                    aria-label="Heater plus 5"
                    className={stepBtnCls}
                    {...plusHold}
                >
                    +5
                </button>
            </div>

            <div
                role="slider"
                tabIndex={blocked ? -1 : 0}
                aria-label={unsupported ? 'Heater not supported' : 'Heater setpoint'}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={Math.round(current)}
                aria-disabled={blocked}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        commit(stepPercent(valueRef.current, 5, min, max));
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        commit(stepPercent(valueRef.current, -5, min, max));
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
                        const isTen = tick % 10 === 0;
                        const isSelected = tick === selected;
                        const labelCls = (on: boolean) =>
                            cn(
                                'w-6 shrink-0 font-mono text-[10px] leading-none',
                                on
                                    ? isSelected
                                        ? 'font-semibold text-(--color-control-heat)'
                                        : isTen
                                          ? 'text-secondary'
                                          : 'text-muted'
                                    : 'invisible',
                            );
                        const hitCls =
                            'flex min-h-0 cursor-pointer items-center self-stretch border-none bg-transparent p-0 disabled:cursor-not-allowed';
                        return (
                            <div key={tick} className="flex h-0 min-h-0 flex-1 items-center gap-1">
                                {isTen ? (
                                    <button
                                        type="button"
                                        data-tick={tick}
                                        data-tick-label="ten"
                                        disabled={blocked}
                                        aria-label={`Heater ${tick}${unit}`}
                                        aria-pressed={isSelected}
                                        onClick={() => commit(tick)}
                                        className={cn(hitCls, labelCls(true), 'justify-end text-right')}
                                    >
                                        {tick}
                                    </button>
                                ) : (
                                    <span
                                        data-tick-gutter={tick}
                                        data-tick-label="ten"
                                        className={cn(labelCls(false), 'self-stretch text-right')}
                                    />
                                )}
                                <button
                                    type="button"
                                    data-tick-bar={tick}
                                    disabled={blocked}
                                    aria-label={`Heater ${tick}${unit}`}
                                    onClick={() => commit(tick)}
                                    className={cn(hitCls, 'min-w-0 flex-1')}
                                >
                                    <span
                                        className={cn(
                                            'rounded-full',
                                            isSelected
                                                ? 'h-0.5 w-full bg-(--color-control-heat)'
                                                : isTen
                                                  ? 'h-px w-full bg-border'
                                                  : 'ml-auto h-px w-3 bg-border-subtle',
                                        )}
                                    />
                                </button>
                                {!isTen ? (
                                    <button
                                        type="button"
                                        data-tick={tick}
                                        data-tick-label="five"
                                        disabled={blocked}
                                        aria-label={`Heater ${tick}${unit}`}
                                        aria-pressed={isSelected}
                                        onClick={() => commit(tick)}
                                        className={cn(hitCls, labelCls(true), 'justify-start text-left')}
                                    >
                                        {tick}
                                    </button>
                                ) : (
                                    <span data-tick-label="five" className={cn(labelCls(false), 'text-left')} />
                                )}
                            </div>
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
