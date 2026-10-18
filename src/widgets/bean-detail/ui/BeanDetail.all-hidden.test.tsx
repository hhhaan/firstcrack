// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeanDetail } from './BeanDetail';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@entities/bean-stock-event', () => ({
    useBeanStockSummary: () => ({ data: undefined }),
    useBeanStockEvents: () => ({ data: [] }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BeanDetail all-hidden empty state', () => {
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

    it('shows the all-hidden message and show-hidden action when the catalog has beans but none are selected', () => {
        act(() =>
            root.render(
                createElement(BeanDetail, {
                    bean: null,
                    hasAny: true,
                    allHidden: true,
                    onShowHidden,
                    isLoading: false,
                    affectedBlendNames: [],
                    onEdit: vi.fn(),
                    onRestock: vi.fn(),
                    onStartRoast: vi.fn(),
                    onDelete: vi.fn(),
                }),
            ),
        );

        expect(host.textContent).toContain('beanDetail.empty.allHidden');
        expect(host.textContent).not.toContain('beanDetail.empty.addFirst');
        act(() => host.querySelector('button')?.click());
        expect(onShowHidden).toHaveBeenCalledTimes(1);
    });
});
