// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SearchableSelect, SelectMenuGroup } from './SearchableSelect';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows locale keys for empty search, not hardcoded Korean', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
        root.render(
            createElement(SearchableSelect, {
                placeholder: 'Select lot...',
                items: [],
                selectedId: '',
                onSelect: () => {},
                renderLabel: () => '',
            }),
        ),
    );

    const button = host.querySelector('button');
    act(() => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = host.querySelector('input');
    expect(input?.getAttribute('placeholder')).toBe('addBatchModal.searchPlaceholder');
    expect(host.textContent).toContain('addBatchModal.noResults');
    expect(host.textContent).not.toContain('검색...');
    expect(host.textContent).not.toContain('결과 없음');

    act(() => root.unmount());
    host.remove();
});

it('uses the error border only when invalid', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const props = {
        placeholder: 'Lot',
        items: [] as { id: string }[],
        selectedId: '',
        onSelect: () => {},
        renderLabel: () => '',
    };
    act(() => root.render(createElement(SearchableSelect, props)));
    expect(host.querySelector('button')?.className).not.toContain('border-red-500');
    act(() => root.render(createElement(SearchableSelect, { ...props, invalid: true })));
    expect(host.querySelector('button')?.className).toContain('border-red-500');
    expect(host.querySelector('button')?.getAttribute('aria-invalid')).toBe('true');
    act(() => root.unmount());
    host.remove();
});

it('closes the open menu when another one opens', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const select = (menuId: string, option: string) =>
        createElement(SearchableSelect, {
            menuId,
            placeholder: menuId,
            items: [{ id: option }],
            selectedId: '',
            onSelect: () => {},
            renderLabel: () => option,
        });
    act(() =>
        root.render(
            createElement(SelectMenuGroup, null, select('date', 'Date option'), select('machine', 'Machine option')),
        ),
    );

    const trigger = (placeholder: string) =>
        [...host.querySelectorAll('button')].find((button) => button.textContent === placeholder);
    act(() => trigger('date')?.click());
    expect(host.textContent).toContain('Date option');

    act(() => trigger('machine')?.click());
    expect(host.textContent).toContain('Machine option');
    expect(host.textContent).not.toContain('Date option');

    act(() => root.unmount());
    host.remove();
});
