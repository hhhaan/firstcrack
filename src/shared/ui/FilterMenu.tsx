import { ChevronDown, X } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';

export const filterMenuTriggerCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 whitespace-nowrap h-10 rounded-xl border border-border bg-input-bg px-3 py-2 text-sm shadow-xs font-medium tracking-[0.14px] transition ${
        active ? 'border-strong-border text-primary' : 'text-secondary hover:border-strong-border hover:text-primary'
    }`;

export const filterMenuPanelCls =
    'absolute border border-border-subtle dark:border-border top-full left-0 z-50 mt-2 flex rounded-lg bg-main-bg overflow-hidden shadow-xs';

export const filterMenuListCls = 'flex shrink-0 flex-col gap-0.5 py-2 px-2';

export const filterMenuItemCls = (selected: boolean) =>
    `w-full rounded-md px-2.5 py-1.5 text-left text-[13px] tracking-[0.14px] wrap-break-word transition hover:bg-surface cursor-pointer border-none bg-transparent ${
        selected ? 'font-semibold text-primary' : 'text-secondary'
    }`;

interface FilterMenuTriggerProps {
    active: boolean;
    label: ReactNode;
    onToggle: () => void;
    onClear: () => void;
}

export const FilterMenuTrigger = ({ active, label, onToggle, onClear }: FilterMenuTriggerProps): ReactNode => {
    const clear = (event: MouseEvent) => {
        event.stopPropagation();
        onClear();
    };

    return (
        <button type="button" onClick={onToggle} className={filterMenuTriggerCls(active)}>
            {label}
            {active ? (
                <X size={11} strokeWidth={2.5} className="text-muted hover:text-primary" onClick={clear} />
            ) : (
                <ChevronDown size={11} strokeWidth={2} className="text-muted" />
            )}
        </button>
    );
};
