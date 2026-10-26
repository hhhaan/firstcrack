import { type ReactNode, useEffect, useRef, useState } from 'react';
import { FilterMenuTrigger, filterMenuItemCls, filterMenuListCls, filterMenuPanelCls } from './FilterMenu';

interface FilterDropdownProps {
    label: string;
    value: string;
    options: string[];
    onSelect: (v: string) => void;
    /** Maps an option value to display text. Omit when the value is already user-facing. */
    optionLabel?: (v: string) => string;
}

export const FilterDropdown = ({
    label,
    value,
    options,
    onSelect,
    optionLabel = (v) => v,
}: FilterDropdownProps): ReactNode => {
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

    const select = (next: string) => {
        onSelect(next);
        setOpen(false);
    };

    return (
        <div ref={ref} className="relative">
            <FilterMenuTrigger
                active={isActive}
                label={isActive ? optionLabel(value) : label}
                onToggle={() => setOpen((o) => !o)}
                onClear={() => select('all')}
            />

            {open && (
                <div className={filterMenuPanelCls}>
                    <div className={`${filterMenuListCls} w-max min-w-36 max-w-48`}>
                        <button
                            type="button"
                            onClick={() => select('all')}
                            className={filterMenuItemCls(value === 'all')}
                        >
                            {label}
                        </button>
                        {options.map((opt) => (
                            <button
                                type="button"
                                key={opt}
                                onClick={() => select(opt)}
                                className={filterMenuItemCls(value === opt)}
                            >
                                {optionLabel(opt)}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
