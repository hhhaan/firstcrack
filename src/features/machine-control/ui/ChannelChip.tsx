import type { ControlLimit } from '@entities/machine';
import { cn } from '@shared/lib/cn';
import { useRef } from 'react';
import type { ControlRole } from '../lib/controlSender';
import { isPercentUnit, stepPercent } from '../lib/snapPercent';
import { useHoldRepeat } from '../lib/useHoldRepeat';

const ROLE_LABEL = { fan: 'Fan', drum: 'Drum' } as const;

interface Props {
    role: 'fan' | 'drum';
    limit: ControlLimit;
    value: number | undefined;
    feedback: number | null;
    unacknowledged: boolean;
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
    unacknowledged,
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
                <span
                    className={cn(
                        'min-w-6 text-center font-mono text-[12px] font-semibold',
                        unacknowledged ? 'text-red-500' : 'text-primary',
                    )}
                >
                    {unsupported ? '—' : Math.round(current)}
                </span>
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
