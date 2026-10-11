// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isEscapeKeyConsumed, markEscapeKeyConsumed, shouldDeferDialogEscape } from './dialogEscape';

describe('shouldDeferDialogEscape', () => {
    it('defers when escape was consumed on the native event', () => {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
        markEscapeKeyConsumed(event);
        expect(shouldDeferDialogEscape(event)).toBe(true);
    });

    it('defers when a bean combobox list is open', () => {
        document.body.innerHTML = `
          <div data-bean-combobox>
            <input role="combobox" aria-expanded="true" />
            <div role="listbox"><button role="option">Yirg</button></div>
          </div>
        `;
        const option = document.querySelector('[role="option"]') as HTMLButtonElement;
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
        Object.defineProperty(event, 'target', { value: option });
        expect(shouldDeferDialogEscape(event)).toBe(true);
    });
});

describe('isEscapeKeyConsumed', () => {
    it('reads the marked flag', () => {
        const event = new KeyboardEvent('keydown', { key: 'Escape' });
        expect(isEscapeKeyConsumed(event)).toBe(false);
        markEscapeKeyConsumed(event);
        expect(isEscapeKeyConsumed(event)).toBe(true);
    });
});
