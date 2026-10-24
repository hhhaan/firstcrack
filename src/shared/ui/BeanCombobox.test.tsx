// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BeanCombobox, type BeanComboboxOption } from './BeanCombobox';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BeanCombobox', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        vi.useRealTimers();
    });

    const render = (items: BeanComboboxOption[], initialQuery = '', initialId = 'bean-1') => {
        const onSelect = vi.fn();
        const onFreeTextCommit = vi.fn();
        let resetSelection = () => {};
        const Harness = ({ items }: { items: BeanComboboxOption[] }) => {
            const [selectedId, setSelectedId] = useState(initialId);
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
        act(() => root.render(createElement(Harness, { items })));
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
        const updateItems = (next: typeof items) => act(() => root.render(createElement(Harness, { items: next })));
        const blur = () =>
            act(() => {
                input.focus();
                input.blur();
                vi.advanceTimersByTime(120);
            });
        return { input, type, enter, blur, options, clearSelection, updateItems, onSelect, onFreeTextCommit };
    };

    const items = [
        { id: 'bean-1', name: 'Aricha' },
        { id: 'bean-2', name: 'Kenya Nyeri' },
    ];

    it('groups options under their labels and hides groups without search matches', () => {
        const picker = render([
            { id: 'bean-1', name: 'Aricha', group: 'Single' },
            { id: 'blend-1', name: 'House blend', group: 'Blend' },
        ]);
        act(() => picker.input.focus());
        const groups = () => [...host.querySelectorAll('[role="group"]')];
        expect(groups().map((group) => group.getAttribute('aria-label'))).toEqual(['Single', 'Blend']);
        expect(groups().map((group) => group.querySelector('[role="option"]')?.textContent)).toEqual([
            'Aricha',
            'House blend',
        ]);
        picker.type('House');
        expect(groups().map((group) => group.getAttribute('aria-label'))).toEqual(['Blend']);
        picker.enter();
        expect(picker.onSelect).toHaveBeenLastCalledWith('blend-1');
    });

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

    it.each(['enter', 'blur'] as const)('preserves a selected blend sharing a bean name on %s', (commit) => {
        vi.useFakeTimers();
        const picker = render(
            [
                { id: 'bean-1', name: 'House' },
                { id: 'blend-1', name: 'House' },
            ],
            '',
            'blend-1',
        );
        picker[commit]();
        expect(picker.onSelect).toHaveBeenLastCalledWith('blend-1');
        expect(picker.onSelect).not.toHaveBeenCalledWith('bean-1');
        expect(picker.onFreeTextCommit).not.toHaveBeenCalled();
    });

    it('updates a placeholder when the selected name arrives without changing the id', () => {
        const { input, updateItems } = render([{ id: 'blend-1', name: 'blend-1' }], '', 'blend-1');
        updateItems([]);
        expect(input.value).toBe('blend-1');
        updateItems([{ id: 'blend-1', name: 'House blend' }]);
        expect(input.value).toBe('House blend');
    });

    it('fills an initially missing selection when options finish loading', () => {
        const { input, updateItems } = render([], 'Saved label', 'blend-1');
        updateItems([{ id: 'blend-1', name: 'House blend' }]);
        expect(input.value).toBe('House blend');
    });

    it('preserves a draft typed before the selected option arrives', () => {
        const { input, type, updateItems } = render([], 'Saved label', 'blend-1');
        type('My new label');
        updateItems([{ id: 'blend-1', name: 'House blend' }]);
        expect(input.value).toBe('My new label');
    });
});
