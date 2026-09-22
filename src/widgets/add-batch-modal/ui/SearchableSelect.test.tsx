// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SearchableSelect } from './SearchableSelect';

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

it('shows the selected profile name instead of the empty placeholder', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
        root.render(
            createElement(SearchableSelect, {
                placeholder: '프로파일 선택...',
                items: [{ id: 'prof-1' }],
                selectedId: 'prof-1',
                onSelect: () => {},
                renderLabel: () => 'Ethiopia Light',
            }),
        ),
    );

    expect(host.querySelector('button')?.textContent).toContain('Ethiopia Light');
    expect(host.querySelector('button')?.textContent).not.toContain('프로파일 선택...');

    act(() => root.unmount());
    host.remove();
});
