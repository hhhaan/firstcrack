export const inputCls =
    'w-full px-3.5 py-2.5 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all focus:border-black/20 dark:focus:border-[#585d61]';

export const labelCls =
    'flex items-center gap-1.5 text-[11px] font-semibold text-muted mb-1.5 tracking-[0.04em] uppercase';

export const tabCls = (active: boolean) =>
    `flex-1 py-2 rounded-xl border-none text-[13px] cursor-pointer transition-all duration-200 ${
        active
            ? 'bg-white dark:bg-surface-elevated font-semibold text-primary dark:text-[#e5e5e5] shadow-[0_2px_8px_rgba(0,0,0,0.08)]'
            : 'bg-transparent font-medium text-muted dark:text-[#e5e5e5] hover:text-secondary dark:hover:text-white/70'
    }`;
