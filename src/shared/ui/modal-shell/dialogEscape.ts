export type EscapeMarkedEvent = KeyboardEvent & { __fcEscapeConsumed?: boolean };

export const markEscapeKeyConsumed = (nativeEvent: KeyboardEvent): void => {
    nativeEvent.preventDefault();
    (nativeEvent as EscapeMarkedEvent).__fcEscapeConsumed = true;
};

export const isEscapeKeyConsumed = (event: KeyboardEvent): boolean =>
    Boolean(event.defaultPrevented || (event as EscapeMarkedEvent).__fcEscapeConsumed);

const isOpenBeanCombobox = (el: Element | null): boolean => {
    if (!el) return false;
    const root = el.closest('[data-bean-combobox]');
    if (!root) return false;
    const combo = root.querySelector('[role="combobox"]');
    return combo?.getAttribute('aria-expanded') === 'true';
};

/** True when a parent dialog should not handle Escape (open overlays, text fields, consumed keys). */
export const shouldDeferDialogEscape = (event: KeyboardEvent): boolean => {
    if (event.key !== 'Escape' || event.isComposing) return false;
    if (isEscapeKeyConsumed(event)) return true;

    const target = event.target instanceof Element ? event.target : null;
    const active = document.activeElement;

    if (isOpenBeanCombobox(target) || isOpenBeanCombobox(active)) return true;

    const openListbox = document.querySelector('[data-bean-combobox] [role="listbox"]');
    if (openListbox && target && openListbox.contains(target)) return true;

    if (active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return true;
    if (active instanceof HTMLElement && active.isContentEditable) return true;

    if (active instanceof HTMLInputElement && !active.closest('[data-bean-combobox]')) return true;

    return false;
};
