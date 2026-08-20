/**
 * Shared form field tokens for modals and settings panels.
 * Prefer these over local inputCls/labelCls copies.
 */

export const inputCls =
    'w-full px-3.5 py-2.5 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all focus:border-black/20 dark:focus:border-[#585d61]';

/** Native select matching `inputCls` — hide OS chrome; pair with FormSelect chevron. */
export const selectCls = `${inputCls} appearance-none cursor-pointer pr-10`;

export const labelCls =
    'flex items-center gap-1.5 text-[11px] font-semibold text-muted mb-1.5 tracking-[0.04em] uppercase';

export const tabCls = (active: boolean) =>
    `flex-1 py-2 rounded-xl border-none text-[13px] cursor-pointer transition-all duration-200 ${
        active
            ? 'bg-white dark:bg-surface-elevated font-semibold text-primary dark:text-[#e5e5e5] shadow-[0_2px_8px_rgba(0,0,0,0.08)]'
            : 'bg-transparent font-medium text-muted dark:text-[#e5e5e5] hover:text-secondary dark:hover:text-white/70'
    }`;

export const chipCls = (selected: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all duration-150 border ${
        selected
            ? 'border-primary bg-primary text-white dark:bg-transparent dark:text-secondary dark:border-[#585d61]'
            : 'border-black/10 dark:border-[#585d61] bg-white/70 dark:bg-surface-elevated text-secondary'
    }`;

/** Sticky header chrome for form modals (matches AddBeanModal). */
export const modalHeaderChrome =
    'shrink-0 z-10 border-b border-black/4 bg-white/60 backdrop-blur-sm dark:border-[#585d61] dark:bg-[#1a1e23]';

/** Sticky footer chrome for form modals. */
export const modalFooterChrome =
    'shrink-0 border-t border-black/4 bg-white/80 px-8 pt-5 pb-8 backdrop-blur-sm dark:border-[#585d61] dark:bg-[#1a1e23]';

export const modalCancelBtnCls =
    'flex-1 cursor-pointer rounded-2xl border-none bg-surface py-3.5 text-[15px] font-semibold text-secondary shadow-(--shadow-inset) dark:bg-surface-elevated dark:text-[#e5e5e5]';

export const modalPrimaryBtnCls =
    'flex-1 cursor-pointer rounded-2xl border border-transparent bg-primary py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-opacity duration-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white dark:bg-black';

/** Inline validation under form fields. */
export const formErrorCls = 'text-[11px] text-red-500 mt-1';
