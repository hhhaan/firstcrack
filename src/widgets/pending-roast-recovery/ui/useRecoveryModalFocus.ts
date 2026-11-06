import { type RefObject, useEffect, useRef } from 'react';

const focusable = (dialog: HTMLElement) =>
    [...dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, summary, [tabindex]')].filter(
        (element) => {
            const closedDetails = element.closest('details:not([open])');
            return (
                element.tabIndex >= 0 &&
                !element.matches(':disabled') &&
                !element.matches('input[type="hidden"]') &&
                !element.closest('[hidden], [inert]') &&
                (!closedDetails || element === closedDetails.querySelector('summary'))
            );
        },
    );

/** Scoped to recovery: Radix selects keep their existing body portals and keyboard handling. */
export const useRecoveryModalFocus = (open: boolean, ref: RefObject<HTMLDivElement | null>, suspended = false) => {
    const paused = useRef(suspended);
    useEffect(() => {
        paused.current = suspended;
    }, [suspended]);
    useEffect(() => {
        const dialog = ref.current;
        if (!open || !dialog) return;
        const previous = document.activeElement;
        const background = [...document.body.children].filter(
            (element): element is HTMLElement =>
                element instanceof HTMLElement &&
                !element.inert &&
                !element.contains(dialog) &&
                !element.hasAttribute('data-radix-popper-content-wrapper'),
        );
        for (const element of background) element.inert = true;
        const initial = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? focusable(dialog)[0];
        initial?.focus();
        let last = initial;
        const onFocus = (event: FocusEvent) => {
            if (paused.current || !(event.target instanceof HTMLElement)) return;
            if (dialog.contains(event.target)) last = event.target;
            else if (!event.target.closest('[data-radix-popper-content-wrapper]'))
                (last?.isConnected && !last.matches(':disabled') ? last : focusable(dialog)[0])?.focus();
        };
        const onKey = (event: KeyboardEvent) => {
            if (
                paused.current ||
                event.key !== 'Tab' ||
                !(event.target instanceof Node) ||
                !dialog.contains(event.target)
            )
                return;
            const items = focusable(dialog);
            const lastItem = items[items.length - 1];
            const next = event.shiftKey ? lastItem : items[0];
            if (document.activeElement === (event.shiftKey ? items[0] : lastItem)) {
                event.preventDefault();
                next?.focus();
            }
        };
        document.addEventListener('focusin', onFocus);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('focusin', onFocus);
            document.removeEventListener('keydown', onKey);
            for (const element of background) element.inert = false;
            const fallback = document.querySelector<HTMLElement>(
                '[data-testid="pending-roast-close"], [data-testid="pending-roast-trigger"]',
            );
            (previous instanceof HTMLElement && previous.isConnected && !previous.closest('[inert]')
                ? previous
                : fallback
            )?.focus();
        };
    }, [open, ref]);
};
