// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecurringDeleteScopeModal } from './RecurringDeleteScopeModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

describe('RecurringDeleteScopeModal', () => {
    let container: HTMLDivElement;
    let root: Root;
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const render = (open = true) => {
        act(() => {
            root.render(
                createElement(RecurringDeleteScopeModal, {
                    open,
                    onClose,
                    onConfirm,
                    batchLabel: 'Ethiopia / 25kg',
                    recurrenceLabel: 'Daily',
                }),
            );
        });
    };

    const button = (text: string) => {
        const match = [...document.querySelectorAll('button')].find((item) => item.textContent === text);
        if (!match) throw new Error(`Missing button: ${text}`);
        return match;
    };

    it('only submits the selected scope after pressing Delete', () => {
        render();
        const radio = document.querySelector<HTMLInputElement>('input[value="all"]');
        expect(radio).not.toBeNull();
        act(() => radio?.click());
        expect(radio?.checked).toBe(true);
        expect(onConfirm).not.toHaveBeenCalled();

        act(() => button('common.delete').click());
        expect(onConfirm).toHaveBeenCalledExactlyOnceWith('all');
    });

    it('keeps this occurrence available and selected', () => {
        render();
        expect(document.querySelector('input[value="single"]')).not.toBeNull();
        expect(document.querySelector('input[value="from_this"]')).not.toBeNull();
        expect(document.querySelector('input[value="all"]')).not.toBeNull();
        expect(document.querySelector<HTMLInputElement>('input[value="single"]')?.checked).toBe(true);
        act(() => button('common.delete').click());
        expect(onConfirm).toHaveBeenCalledExactlyOnceWith('single');
    });

    it('cancels and closes without submitting a scope', () => {
        render();
        act(() => button('common.cancel').click());
        act(() => document.querySelector<HTMLButtonElement>('[aria-label="common.close"]')?.click());
        expect(onClose).toHaveBeenCalledTimes(2);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('resets a broader selection when reopened', () => {
        render();
        act(() => document.querySelector<HTMLInputElement>('input[value="all"]')?.click());
        render(false);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        render();
        expect(document.querySelector<HTMLInputElement>('input[value="single"]')?.checked).toBe(true);
    });
});
