// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BeanCombobox } from './BeanCombobox';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BeanCombobox', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
    });

    const render = (items: { id: string; name: string }[], initialQuery = '') => {
        const onSelect = vi.fn();
        const onFreeTextCommit = vi.fn();
        let resetSelection = () => {};
        const Harness = () => {
            const [selectedId, setSelectedId] = useState('bean-1');
            resetSelection = () => setSelectedId('');
            return createElement(BeanCombobox, {
                items,
                initialQuery,
                selectedId,
                onSelect: (id: string) => {
                    onSelect(id);
                    setSelectedId(id);
                },
                onFreeTextCommit,
                'data-testid': 'bean',
            });
        };
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root.render(createElement(Harness)));
        const input = host.querySelector('[data-testid="bean"] input') as HTMLInputElement;
        const type = (value: string) =>
            act(() => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        const enter = () =>
            act(() => {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            });
        const options = () => [...host.querySelectorAll('[role="option"]')].map((el) => el.textContent);
        const clearSelection = () => act(() => resetSelection());
        return { input, type, enter, options, clearSelection, onSelect, onFreeTextCommit };
    };

    const items = [
        { id: 'bean-1', name: 'Aricha' },
        { id: 'bean-2', name: 'Kenya Nyeri' },
    ];

    it('keeps typed free text when it unlinks the selected bean', () => {
        const { input, type, onSelect } = render(items);
        type('Sample bag');
        expect(input.value).toBe('Sample bag');
        expect(onSelect).toHaveBeenLastCalledWith('');
    });

    it('commits free text instead of the only bean when the text matches nothing', () => {
        const { input, type, enter, onSelect, onFreeTextCommit } = render([{ id: 'bean-1', name: 'Aricha' }]);
        type('Ethiopia Guji');
        enter();
        expect(onFreeTextCommit).toHaveBeenCalledWith('Ethiopia Guji');
        expect(onSelect).not.toHaveBeenCalledWith('bean-1');
        expect(input.value).toBe('Ethiopia Guji');
    });

    it('auto-selects the single real match', () => {
        const { type, enter, onSelect } = render(items);
        type('kenya');
        enter();
        expect(onSelect).toHaveBeenCalledWith('bean-2');
    });

    it('falls back to the stored free-text label when the link is cleared without typing', () => {
        const { input, clearSelection } = render(items, 'Stored label');
        expect(input.value).toBe('Aricha');
        clearSelection();
        expect(input.value).toBe('Stored label');
    });

    it('keeps typed text when the link is cleared by the caller mid-edit', () => {
        const { input, type, clearSelection } = render(items, 'Stored label');
        type('Fresh sample');
        clearSelection();
        expect(input.value).toBe('Fresh sample');
    });
});
