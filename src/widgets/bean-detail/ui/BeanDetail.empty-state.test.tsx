// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

const detailActions = {
    isLoading: false,
    bean: null,
    affectedBlendNames: [],
    onEdit: vi.fn(),
    onRestock: vi.fn(),
    onStartRoast: vi.fn(),
    onDelete: vi.fn(),
};

describe.each([
    {
        case: 'all hidden',
        allHidden: true,
        hasAny: true,
        expectMessage: 'beanDetail.empty.allHidden',
        expectShowHiddenButton: true,
    },
    {
        case: 'no beans in catalog',
        allHidden: false,
        hasAny: false,
        expectMessage: 'beanDetail.empty.addFirst',
        expectShowHiddenButton: false,
    },
])('BeanDetail empty panel ($case)', ({ allHidden, hasAny, expectMessage, expectShowHiddenButton }) => {
    let host: HTMLDivElement;
    let root: Root;
    let qc: QueryClient;
    const onShowHidden = vi.fn();

    beforeEach(() => {
        onShowHidden.mockClear();
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() =>
            root.render(
                createElement(
                    QueryClientProvider,
                    { client: qc },
                    createElement(BeanDetail, {
                        ...detailActions,
                        hasAny,
                        allHidden,
                        onShowHidden,
                    }),
                ),
            ),
        );
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        qc.clear();
    });

    it('shows the expected empty message', () => {
        expect(host.textContent).toContain(expectMessage);
        if (expectMessage === 'beanDetail.empty.allHidden') {
            expect(host.textContent).not.toContain('beanDetail.empty.addFirst');
        }
    });

    it('wires show hidden only for all-hidden', () => {
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
