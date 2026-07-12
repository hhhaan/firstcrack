import { ChevronDown, Filter } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

interface FilterDropdownProps {
    label: string;
    value: string;
    options: string[];
    onSelect: (v: string) => void;
}

export const FilterDropdown = ({ label, value, options, onSelect }: FilterDropdownProps): ReactNode => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const isActive = value !== 'all';

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg border-0 px-3 py-2 text-[13px] font-medium tracking-[0.14px] transition ${
                    isActive
                        ? 'bg-surface-warm-solid text-primary'
                        : 'bg-surface dark:bg-surface-elevated text-secondary hover:-translate-y-px hover:text-primary'
                }`}
            >
                <Filter size={12} strokeWidth={2} className={isActive ? 'text-primary' : 'text-muted'} />
                {isActive ? value : label}
                <ChevronDown size={11} strokeWidth={2} className={isActive ? 'text-primary' : 'text-muted'} />
            </button>

            {open && (
                <div className="absolute top-full left-0 z-50 mt-1 min-w-35 rounded-lg bg-main-bg dark:bg-surface-elevated py-1 shadow-lg">
                    <button
                        type="button"
                        onClick={() => {
                            onSelect('all');
                            setOpen(false);
                        }}
                        className={`w-full px-3 py-1.5 text-left text-[13px] tracking-[0.14px] transition hover:bg-surface ${value === 'all' ? 'font-medium text-primary' : 'text-secondary'}`}
                    >
                        {label}
                    </button>
                    {options.map((opt) => (
                        <button
                            type="button"
                            key={opt}
                            onClick={() => {
                                onSelect(opt);
                                setOpen(false);
                            }}
                            className={`w-full px-3 py-1.5 text-left text-[13px] tracking-[0.14px] transition hover:bg-surface ${value === opt ? 'font-medium text-primary' : 'text-secondary'}`}
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
