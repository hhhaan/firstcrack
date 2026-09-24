import type { ControlLimit } from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { useEffect, useRef, useState } from 'react';
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
    'flex h-8 flex-1 items-center justify-center rounded-md border border-border bg-transparent font-mono text-xs text-secondary hover:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed';

/**
 * 숫자 버튼·±5·키보드는 5% 즉시 전송. 세로 range·큰 숫자 입력은 1단위 미리보기, 손 뗄 때 전송.
 * 채움·손잡이·선택 숫자는 desired(드래그 중엔 preview). 가로선·기기 n은 커밋 뒤에만.
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
    const ticks = percentTicks(min, max);
    const blocked = disabled || unsupported;
    const span = max - min || 1;
    const [preview, setPreview] = useState<number | null>(null);
    const shown = preview ?? current;
    const live = !unsupported && preview == null && showLiveFollow(value, feedback, CONVERGE_TOLERANCE);
    const fillPct = Math.min(100, Math.max(0, ((shown - min) / span) * 100));
    const livePct = feedback != null ? Math.min(100, Math.max(0, ((feedback - min) / span) * 100)) : null;
    const selected = Math.round(shown);
    const valueRef = useRef(current);
    const [draft, setDraft] = useState<string | null>(null);
    const skipCommitRef = useRef(false);
    const originRef = useRef(current);
    const maxDigits = String(Math.floor(Math.max(Math.abs(min), Math.abs(max), 1))).length;
    useEffect(() => {
        if (preview == null) valueRef.current = current;
    }, [current, preview]);

    const commit = (next: number) => {
        if (blocked) return;
        const snapped = snapPercent(next, min, max);
        valueRef.current = snapped;
        onChange('heater', snapped);
        onCommit();
    };

    const dragTo = (raw: number) => {
        if (blocked) return;
        const next = Math.min(max, Math.max(min, Math.round(raw)));
        valueRef.current = next;
        setPreview(next);
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

    const finishDrag = () => {
        if (blocked) {
            setPreview(null);
            return;
        }
        if (preview != null) onChange('heater', preview);
        onCommit();
        setPreview(null);
    };

    const restoreOrigin = () => {
        valueRef.current = originRef.current;
        setPreview(null);
        setDraft(null);
    };

    const finishType = () => {
        if (skipCommitRef.current) {
            skipCommitRef.current = false;
            restoreOrigin();
            return;
        }
        if (blocked || draft == null) {
            setDraft(null);
            setPreview(null);
            return;
        }
        if (draft === '') {
            restoreOrigin();
            return;
        }
        const next = preview ?? Math.min(max, Math.max(min, Math.round(Number(draft))));
        valueRef.current = next;
        onChange('heater', next);
        onCommit();
        setPreview(null);
        setDraft(null);
    };

    return (
        <div className={cn('flex min-w-0 shrink-0 flex-col gap-3', (disabled || sending) && 'opacity-40')}>
            <div className="flex items-center justify-between gap-1">
                <div className="flex flex-col">
                    <span className="text-xs font-medium text-secondary">Heater</span>
                    {lockedNote && <span className="text-[10px] text-muted">{lockedNote}</span>}
                </div>
                <div className="flex flex-col items-end">
                    <div className="flex items-baseline">
                        {unsupported ? (
                            <span className="text-[28px] font-semibold leading-tight tracking-[-1px] text-primary">
                                —
                            </span>
                        ) : (
                            <input
                                data-heater-input
                                type="text"
                                inputMode="numeric"
                                disabled={blocked}
                                aria-label="Heater setpoint value"
                                value={draft ?? String(Math.round(shown))}
                                onChange={(e) => {
                                    if (blocked) return;
                                    const next = e.target.value.replace(/\D/g, '').slice(0, maxDigits);
                                    setDraft(next);
                                    if (next !== '') dragTo(Number(next));
                                }}
                                onBlur={finishType}
                                onFocus={(e) => {
                                    originRef.current = current;
                                    e.currentTarget.select();
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        e.currentTarget.blur();
                                    } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        skipCommitRef.current = true;
                                        e.currentTarget.blur();
                                    }
                                }}
                                className="w-[3.5ch] border-0 bg-transparent p-0 text-right text-[28px] font-semibold leading-tight tracking-[-1px] text-primary tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed"
                            />
                        )}
                        {!unsupported && <span className="ml-0.5 text-sm tracking-normal text-muted">{unit}</span>}
                    </div>
                    {live && feedback != null && (
                        <span className={`font-mono text-[10px] ${unacknowledged ? 'text-red-500' : 'text-muted'}`}>
                            기기 {Math.round(feedback)}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex gap-2">
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

            <div className="relative my-4 h-[420px] shrink-0">
                <div className="pointer-events-none absolute inset-y-0 left-1/2 w-2.5 -translate-x-1/2 overflow-hidden rounded-full bg-surface-elevated">
                    <div
                        className="absolute inset-x-0 bottom-0 bg-(--color-control-heat-area)"
                        style={{ height: `${fillPct}%` }}
                    />
                </div>
                {ticks.map((tick) => {
                    const isTen = tick % 10 === 0;
                    return (
                        <div
                            key={tick}
                            className="pointer-events-none absolute inset-x-0 h-7 translate-y-1/2"
                            style={{ bottom: `${((tick - min) / span) * 100}%` }}
                        >
                            <button
                                type="button"
                                data-tick={tick}
                                data-tick-label={isTen ? 'ten' : 'five'}
                                disabled={blocked}
                                aria-label={`Heater ${tick}${unit}`}
                                aria-pressed={tick === selected}
                                onClick={() => commit(tick)}
                                className={cn(
                                    'pointer-events-auto absolute h-7 w-11 cursor-pointer rounded-md border font-mono text-[11px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed',
                                    isTen ? 'left-0' : 'right-0',
                                    tick === selected
                                        ? 'border-(--color-control-heat) bg-(--color-control-heat-area) font-semibold text-primary'
                                        : 'border-border-subtle bg-main-bg text-secondary hover:border-border hover:bg-surface-elevated',
                                )}
                            >
                                {tick}
                            </button>
                            <span
                                className={cn('absolute top-1/2 h-px w-2 bg-border', isTen ? 'left-12' : 'right-12')}
                            />
                        </div>
                    );
                })}
                {live && livePct != null && (
                    <span
                        data-live-line
                        className={cn(
                            'pointer-events-none absolute left-1/2 z-10 h-0.5 w-9 -translate-x-1/2 translate-y-1/2 rounded-full',
                            unacknowledged ? 'bg-red-500' : 'bg-muted',
                        )}
                        style={{ bottom: `${livePct}%` }}
                    />
                )}
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={1}
                    value={shown}
                    disabled={blocked}
                    aria-label={unsupported ? 'Heater not supported' : 'Heater setpoint'}
                    aria-orientation="vertical"
                    aria-valuetext={`${Math.round(current)}${unit}`}
                    onChange={(e) => dragTo(Number(e.target.value))}
                    onPointerUp={finishDrag}
                    onLostPointerCapture={finishDrag}
                    onPointerCancel={finishDrag}
                    onBlur={finishDrag}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                            e.preventDefault();
                            commit(stepPercent(valueRef.current, 5, min, max));
                        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                            e.preventDefault();
                            commit(stepPercent(valueRef.current, -5, min, max));
                        } else if (e.key === 'Home' || e.key === 'End') {
                            e.preventDefault();
                            commit(e.key === 'Home' ? min : max);
                        }
                    }}
                    className="peer absolute -inset-y-[13px] left-1/2 z-20 m-0 h-[calc(100%+26px)] w-10 -translate-x-1/2 cursor-ns-resize touch-none appearance-none opacity-0 disabled:cursor-not-allowed [direction:rtl] [writing-mode:vertical-lr] [&::-webkit-slider-thumb]:h-[26px] [&::-webkit-slider-thumb]:w-[26px] [&::-webkit-slider-thumb]:appearance-none [&::-moz-range-thumb]:h-[26px] [&::-moz-range-thumb]:w-[26px] [&::-moz-range-thumb]:border-0"
                />
                <div
                    className="pointer-events-none absolute left-1/2 flex h-[26px] w-[26px] -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-md border-[1.5px] border-(--color-control-heat) bg-main-bg shadow-(--shadow-elevation) peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
                    style={{ bottom: `${fillPct}%` }}
                >
                    <span className="h-[3px] w-2.5 border-y border-(--color-control-heat)" />
                </div>
            </div>
        </div>
    );
};
