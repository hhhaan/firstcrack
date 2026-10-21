/**
 * Shared form field tokens for modals and settings panels.
 * Prefer these over local inputCls/labelCls copies.
 */

export const inputCls =
    'w-full min-h-10 rounded-xl border border-border bg-input-bg px-3 py-2 text-sm font-[450] leading-5 text-primary shadow-xs outline-none transition-colors placeholder:text-muted focus:border-strong-border focus-visible:ring-2 focus-visible:ring-strong-border/40 disabled:cursor-not-allowed disabled:opacity-50';

/** Native select matching `inputCls` — hide OS chrome; pair with FormSelect chevron. */
export const selectCls = `${inputCls} appearance-none cursor-pointer pr-10`;

export const labelCls = 'mb-2 flex items-center gap-1.5 text-sm font-medium leading-5 text-primary';

export const tabCls = (active: boolean) =>
    `inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded-full border-0 px-3 py-1.5 text-xs font-medium leading-4 transition-colors ${
        active
            ? 'bg-main-bg text-action shadow-selected dark:bg-surface'
            : 'bg-transparent text-muted hover:text-primary'
    }`;

export const chipCls = (selected: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all duration-150 border ${
        selected ? 'border-action bg-action text-on-action' : 'border-border bg-input-bg text-secondary'
    }`;

/** Sticky header chrome for form modals (matches AddBeanModal). */
export const modalHeaderChrome = 'shrink-0 z-10 border-b border-border bg-main-bg';

/** Sticky footer chrome for form modals. */
export const modalFooterChrome = 'shrink-0 border-t border-border bg-main-bg px-8 pt-5 pb-8';

export const modalCancelBtnCls =
    'inline-flex h-10 flex-1 cursor-pointer items-center justify-center rounded-full border border-action/4 bg-surface px-5 py-3 text-sm font-[550] leading-5 text-action transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-strong-border dark:border-action/5';

export const modalPrimaryBtnCls =
    'inline-flex h-10 flex-1 cursor-pointer items-center justify-center rounded-full border-0 bg-action px-5 py-3 text-sm font-[550] leading-5 text-on-action transition-opacity duration-100 hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-strong-border disabled:cursor-not-allowed disabled:opacity-50';

/** Inline validation under form fields. */
export const formErrorCls = 'text-[11px] text-red-500 mt-1';
