// @vitest-environment jsdom
import { FormField } from '@shared/ui/form-field/FormField';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | undefined;
let root: Root | undefined;

function render(ui: ReactElement) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
        root?.render(ui);
    });
    return host;
}

afterEach(() => {
    act(() => {
        root?.unmount();
    });
    host?.remove();
    root = undefined;
    host = undefined;
});

describe('FormField', () => {
    it('wires label htmlFor to the control id', () => {
        render(
            <FormField.Root id="lot-name">
                <FormField.Label>Lot name</FormField.Label>
                <FormField.Control>
                    <input type="text" />
                </FormField.Control>
            </FormField.Root>,
        );

        const input = document.querySelector('input');
        const label = document.querySelector('label');
        expect(input?.id).toBe('lot-name');
        expect(label?.htmlFor).toBe('lot-name');
    });

    it('sets aria-invalid and describedby when error is present', () => {
        render(
            <FormField.Root id="stock" error="Required">
                <FormField.Label>Stock</FormField.Label>
                <FormField.Control>
                    <input type="text" />
                </FormField.Control>
                <FormField.ErrorMessage />
            </FormField.Root>,
        );

        const input = document.querySelector('input');
        expect(input?.getAttribute('aria-invalid')).toBe('true');
        expect(input?.getAttribute('aria-describedby')).toContain('stock-err');
        expect(document.getElementById('stock-err')?.textContent).toBe('Required');
    });

    it('marks required on the control and shows an asterisk', () => {
        render(
            <FormField.Root id="origin" required>
                <FormField.Label>Origin</FormField.Label>
                <FormField.Control>
                    <input type="text" />
                </FormField.Control>
            </FormField.Root>,
        );

        const input = document.querySelector('input');
        const label = document.querySelector('label');
        expect(input?.getAttribute('aria-required')).toBe('true');
        expect(label?.textContent).toContain('*');
    });
});
