// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeanList } from './BeanList';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BeanList empty states', () => {
    let host: HTMLDivElement;
    let root: Root;
    const onShowHidden = vi.fn();

    beforeEach(() => {
        onShowHidden.mockClear();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it('shows the all-hidden message when the catalog has beans but none are visible', () => {
        act(() =>
            root.render(
                createElement(BeanList, {
                    beans: [],
                    catalogTotal: 2,
                    isLoading: false,
                    selectedId: null,
                    onSelect: vi.fn(),
                    search: '',
                    onSearchChange: vi.fn(),
                    stockSummaries: {},
                    onShowHidden,
                }),
            ),
        );

        expect(host.textContent).toContain('beanList.allHidden');
        expect(host.textContent).not.toContain('beanList.empty');
        act(() => host.querySelector('button')?.click());
        expect(onShowHidden).toHaveBeenCalledTimes(1);
    });

    it('shows the first-bean empty state when the catalog is empty', () => {
        act(() =>
            root.render(
                createElement(BeanList, {
                    beans: [],
                    catalogTotal: 0,
                    isLoading: false,
                    selectedId: null,
                    onSelect: vi.fn(),
                    search: '',
                    onSearchChange: vi.fn(),
                    stockSummaries: {},
                }),
            ),
        );

        expect(host.textContent).toContain('beanList.empty');
        expect(host.textContent).not.toContain('beanList.allHidden');
    });
});
