export const chipCls = (selected: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all duration-150 border ${
        selected
            ? 'border-primary bg-primary text-white dark:bg-transparent dark:text-secondary dark:border-[#585d61]'
            : 'border-black/10 dark:border-[#585d61] bg-white/70 dark:bg-surface-elevated text-secondary'
    }`;

export const tabCls = (active: boolean) =>
    `flex-1 py-3 rounded-xl border-none text-sm cursor-pointer transition-all duration-200 ${
        active
            ? 'bg-white dark:bg-surface-elevated font-semibold text-primary dark:text-[#e5e5e5] shadow-[0_4px_12px_rgba(0,0,0,0.08)]'
            : 'bg-transparent font-medium text-muted dark:text-[#e5e5e5] hover:text-secondary dark:hover:text-white/70'
    }`;

export const inputCls =
    'w-full px-3.5 py-3 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all focus:border-black/20 dark:focus:border-[#585d61]';

export const labelCls = 'flex items-center gap-1.5 text-xs font-semibold text-muted mb-2 tracking-[0.02em] uppercase';
