// @vitest-environment jsdom
import { beanDetailEmptyMessageKey, beanListEmptyMessageKey, CatalogHiddenEmpty } from '@shared/ui/CatalogHiddenEmpty';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('catalog empty message keys', () => {
    it('beanListEmptyMessageKey', () => {
        expect(beanListEmptyMessageKey(2, 0)).toBe('beanList.allHidden');
        expect(beanListEmptyMessageKey(0, 0)).toBe('beanList.empty');
        expect(beanListEmptyMessageKey(0, 1)).toBe('beanList.noResults');
    });

    it('beanDetailEmptyMessageKey', () => {
        expect(beanDetailEmptyMessageKey(true, true)).toBe('beanDetail.empty.allHidden');
        expect(beanDetailEmptyMessageKey(false, true)).toBe('beanDetail.empty.select');
        expect(beanDetailEmptyMessageKey(false, false)).toBe('beanDetail.empty.addFirst');
    });
});

describe('CatalogHiddenEmpty', () => {
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

    it('renders all-hidden copy with show-hidden action', () => {
        act(() =>
            root.render(
                createElement(CatalogHiddenEmpty, {
                    messageKey: 'beanList.allHidden',
                    onShowHidden,
                }),
            ),
        );
        expect(host.textContent).toContain('beanList.allHidden');
        act(() => host.querySelector('button')?.click());
        expect(onShowHidden).toHaveBeenCalledTimes(1);
    });
});
