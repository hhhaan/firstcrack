import type { ControlLimit } from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { useRef, useState } from 'react';
import type { ControlRole } from '../lib/controlSender';
import { isPercentUnit, stepPercent } from '../lib/snapPercent';
import { useHoldRepeat } from '../lib/useHoldRepeat';

const ROLE_LABEL = { fan: 'Fan', drum: 'Drum' } as const;

interface Props {
    role: 'fan' | 'drum';
    limit: ControlLimit;
    value: number | undefined;
    feedback: number | null;
    disabled: boolean;
    lockedNote?: string;
    unsupported?: boolean;
    onChange: (role: ControlRole, value: number) => void;
    onCommit: () => void;
}

const stepBtnCls =
    'flex h-5 w-5 items-center justify-center rounded-full border-none bg-transparent text-[12px] text-secondary disabled:cursor-not-allowed';

export const ChannelChip = ({
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
    const current = unsupported ? min : (value ?? feedback ?? min);
    const step = isPercentUnit(limit.unit) ? 5 : 1;
    const locked = disabled || unsupported;

    const valueRef = useRef(current);
    const [draft, setDraft] = useState<string | null>(null);
    const maxDigits = String(Math.floor(Math.max(Math.abs(min), Math.abs(max), 1))).length;
    const stepBy = (delta: number) => {
        if (locked) return;
        const next = isPercentUnit(limit.unit)
            ? stepPercent(valueRef.current, delta, min, max)
            : Math.min(max, Math.max(min, valueRef.current + delta));
        if (next === valueRef.current) return;
        valueRef.current = next;
        onChange(role, next);
        onCommit();
    };
    const plusHold = useHoldRepeat(
        () => stepBy(step),
        locked,
        () => {
            valueRef.current = current;
        },
    );
    const minusHold = useHoldRepeat(
        () => stepBy(-step),
        locked,
        () => {
            valueRef.current = current;
        },
    );

    const commitType = () => {
        if (locked || !draft) {
            setDraft(null);
            return;
        }
        const next = Math.min(max, Math.max(min, Math.round(Number(draft))));
        valueRef.current = next;
        onChange(role, next);
        onCommit();
        setDraft(null);
    };

    return (
        <div
            className={cn(
                'flex items-center justify-between gap-1 rounded-full border border-black/10 px-2 py-1 dark:border-[#585d61]',
                locked && 'opacity-40',
            )}
        >
            <span className="text-[11px] font-medium text-secondary">{ROLE_LABEL[role]}</span>
            <div className="flex items-center gap-0.5">
                <button
                    type="button"
                    data-step="-5"
                    disabled={locked}
                    aria-label={`${ROLE_LABEL[role]} minus`}
                    className={stepBtnCls}
                    {...minusHold}
                >
                    −
                </button>
                {unsupported ? (
                    <span className="min-w-6 text-center font-mono text-[12px] font-semibold text-primary">—</span>
                ) : (
                    <input
                        data-channel-input
                        type="text"
                        inputMode="numeric"
                        disabled={locked}
                        aria-label={`${ROLE_LABEL[role]} setpoint value`}
                        value={draft ?? String(Math.round(current))}
                        onChange={(e) => {
                            if (locked) return;
                            setDraft(e.target.value.replace(/\D/g, '').slice(0, maxDigits));
                        }}
                        onBlur={() => setDraft(null)}
                        onFocus={(e) => {
                            e.currentTarget.select();
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commitType();
                                e.currentTarget.blur();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                e.currentTarget.blur();
                            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                e.preventDefault();
                                const next = Number(draft || current) + (e.key === 'ArrowUp' ? 1 : -1);
                                setDraft(String(Math.min(max, Math.max(min, next))));
                            }
                        }}
                        className="w-[3ch] border-0 bg-transparent p-0 text-center font-mono text-[12px] font-semibold text-primary tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed"
                    />
                )}
                {!unsupported && limit.unit && <span className="text-[10px] text-muted">{limit.unit}</span>}
                <button
                    type="button"
                    data-step="5"
                    disabled={locked}
                    aria-label={`${ROLE_LABEL[role]} plus`}
                    className={stepBtnCls}
                    {...plusHold}
                >
                    +
                </button>
            </div>
            {lockedNote && <span className="sr-only">{lockedNote}</span>}
        </div>
    );
};
