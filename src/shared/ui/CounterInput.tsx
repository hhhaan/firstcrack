import { useEffect, useRef } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { sanitizeDecimal } from '@shared/lib/format';

const inputCls =
    'w-full rounded-xl border border-[rgba(0,0,0,0.08)] bg-surface px-3.5 py-2.5 text-[13px] text-primary outline-none focus:border-[rgba(0,0,0,0.2)] shadow-(--shadow-inset)';

const labelCls = 'block text-[12px] font-medium text-secondary mb-1.5';

export const CounterInput = ({
    label,
    value,
    onChange,
    placeholder,
    step = 0.1,
}: {
    label: string;
    value: string;
    onChange: (v: string | ((prev: string) => string)) => void;
    placeholder?: string;
    step?: number;
}) => {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const handleAdjust = (delta: number) => {
        onChange((prev) => {
            const current = parseFloat(prev) || 0;
            const next = Math.max(0, Math.round((current + delta) * 100) / 100);
            return String(next);
        });
    };

    const stop = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);
    };

    const start = (delta: number) => {
        stop();
        handleAdjust(delta);
        timerRef.current = setTimeout(() => {
            intervalRef.current = setInterval(() => handleAdjust(delta), 60);
        }, 300);
    };

    useEffect(() => stop, []);

    return (
        <div>
            <label className={labelCls}>{label}</label>
            <div className="relative group">
                <input
                    className={`${inputCls} pr-10`}
                    type="text"
                    inputMode="decimal"
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(sanitizeDecimal(e.target.value))}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-1">
                    <button
                        type="button"
                        onMouseDown={() => start(step)}
                        onMouseUp={stop}
                        onMouseLeave={stop}
                        className="text-muted/40 hover:text-primary transition-colors outline-none"
                    >
                        <ChevronUp size={12} strokeWidth={3} />
                    </button>
                    <button
                        type="button"
                        onMouseDown={() => start(-step)}
                        onMouseUp={stop}
                        onMouseLeave={stop}
                        className="text-muted/40 hover:text-primary transition-colors outline-none"
                    >
                        <ChevronDown size={12} strokeWidth={3} />
                    </button>
                </div>
            </div>
        </div>
    );
};
