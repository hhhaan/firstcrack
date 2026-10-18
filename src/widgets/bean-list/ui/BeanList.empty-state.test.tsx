// @vitest-environment jsdom
import type { Bean } from '@shared/types/database.types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeanList } from './BeanList';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listProps = {
    isLoading: false,
    selectedId: null,
    onSelect: vi.fn(),
    search: '',
    onSearchChange: vi.fn(),
    stockSummaries: {},
};

describe.each([
    {
        case: 'all hidden',
        catalogTotal: 2,
        beans: [] as Bean[],
        expectMessage: 'beanList.allHidden',
        expectShowHiddenButton: true,
    },
    {
        case: 'catalog empty',
        catalogTotal: 0,
        beans: [] as Bean[],
        expectMessage: 'beanList.empty',
        expectShowHiddenButton: false,
    },
])('BeanList empty list ($case)', ({ catalogTotal, beans, expectMessage, expectShowHiddenButton }) => {
    let host: HTMLDivElement;
    let root: Root;
    const onShowHidden = vi.fn();

    beforeEach(() => {
        onShowHidden.mockClear();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() =>
            root.render(
                createElement(BeanList, {
                    ...listProps,
                    beans,
                    catalogTotal,
                    onShowHidden,
                }),
            ),
        );
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it('shows the expected empty message', () => {
        expect(host.textContent).toContain(expectMessage);
        if (expectMessage === 'beanList.allHidden') {
            expect(host.textContent).not.toContain('beanList.empty');
        }
    });

    it('wires show hidden when all catalog beans are hidden', () => {
        const button = host.querySelector('button');
        if (expectShowHiddenButton) {
            expect(button?.textContent).toBe('catalog.showHidden');
            act(() => button?.click());
            expect(onShowHidden).toHaveBeenCalledTimes(1);
        } else {
            expect(button).toBeNull();
        }
    });
});
