// @vitest-environment jsdom
import type { Bean } from '@shared/types/database.types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BeanDetail } from '@widgets/bean-detail/ui/BeanDetail';
import { BeanList } from '@widgets/bean-list/ui/BeanList';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Beans } from './Beans';

const BEAN_ID = 'bean-hidden-1';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@entities/bean-stock-event', () => ({
    useBeanStockSummary: () => ({ data: undefined }),
    useBeanStockEvents: () => ({ data: [] }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bean = (): Bean =>
    ({
        id: BEAN_ID,
        user_id: 'owner',
        name: 'Hidden lot',
        capacity_grams: 5000,
        low_stock_threshold_grams: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        altitude_masl: null,
        cost_per_kg: null,
        farm: null,
        origin: null,
        process: null,
        purchase_date: null,
        region: null,
        tasting_notes: null,
        variety: null,
        vendor: null,
    }) satisfies Bean;

function mountUi(tree: ReactElement) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(tree));
    return {
        host,
        teardown: () => {
            act(() => root.unmount());
            host.remove();
        },
    };
}

describe.each([
    {
        panel: 'BeanList',
        catalogTotal: 2,
        beans: [] as Bean[],
        expectMessage: 'beanList.allHidden',
        forbiddenMessage: 'beanList.empty',
        expectShowHiddenButton: true,
    },
    {
        panel: 'BeanList',
        catalogTotal: 0,
        beans: [] as Bean[],
        expectMessage: 'beanList.empty',
        forbiddenMessage: 'beanList.allHidden',
        expectShowHiddenButton: false,
    },
    {
        panel: 'BeanDetail',
        allHidden: true,
        hasAny: true,
        expectMessage: 'beanDetail.empty.allHidden',
        forbiddenMessage: 'beanDetail.empty.addFirst',
        expectShowHiddenButton: true,
    },
    {
        panel: 'BeanDetail',
        allHidden: false,
        hasAny: false,
        expectMessage: 'beanDetail.empty.addFirst',
        forbiddenMessage: 'beanDetail.empty.allHidden',
        expectShowHiddenButton: false,
    },
])('$panel empty ($expectMessage)', ({ panel, expectMessage, forbiddenMessage, expectShowHiddenButton, ...row }) => {
    let host: HTMLDivElement;
    let teardown: () => void;
    const onShowHidden = vi.fn();
    let qc: QueryClient;

    beforeEach(() => {
        onShowHidden.mockClear();
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const tree =
            panel === 'BeanList'
                ? createElement(BeanList, {
                      isLoading: false,
                      selectedId: null,
                      onSelect: vi.fn(),
                      search: '',
                      onSearchChange: vi.fn(),
                      stockSummaries: {},
                      beans: row.beans ?? [],
                      catalogTotal: row.catalogTotal ?? 0,
                      onShowHidden,
                  })
                : createElement(
                      QueryClientProvider,
                      { client: qc },
                      createElement(BeanDetail, {
                          bean: null,
                          isLoading: false,
                          hasAny: row.hasAny ?? false,
                          allHidden: row.allHidden ?? false,
                          affectedBlendNames: [],
                          onEdit: vi.fn(),
                          onRestock: vi.fn(),
                          onStartRoast: vi.fn(),
                          onDelete: vi.fn(),
                          onShowHidden,
                      }),
                  );
        const mounted = mountUi(tree);
        host = mounted.host;
        teardown = mounted.teardown;
    });

    afterEach(() => {
        teardown();
        qc.clear();
    });

    it('shows the expected copy', () => {
        expect(host.textContent).toContain(expectMessage);
        expect(host.textContent).not.toContain(forbiddenMessage);
    });

    it('show-hidden button', () => {
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

vi.mock('@entities/organization', () => ({ useActiveWorkspace: () => ({ workspaceOwnerId: 'owner' }) }));
vi.mock('@entities/bean/queries', () => ({
    useBeans: () => ({ data: [bean()], isLoading: false }),
    useDeleteBean: () => ({ mutate: vi.fn() }),
}));
vi.mock('@entities/blend', () => ({ useBlends: () => ({ data: [] }) }));
vi.mock('@shared/store/auth', () => ({
    useAuthStore: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: 'auth' } }),
}));
vi.mock('@shared/store/catalog-visibility', () => ({
    useCatalogVisibility: () => ({ hidden: new Set([BEAN_ID]), setHidden: vi.fn() }),
}));
vi.mock('@shared/lib/features', () => ({
    FEATURE: { roastedInventory: 'roasted', productStock: 'products' },
    useFeature: () => false,
}));
vi.mock('./model/useGreenInventoryAssets', () => ({
    useGreenInventoryAssets: () => ({
        summary: { byBeanId: {}, totalAssetValue: 0, unevaluatedCount: 0 },
        stockSummaries: {},
        isLoading: false,
        isError: false,
    }),
}));
vi.mock('@widgets/add-bean-modal/ui/AddBeanModal', () => ({ AddBeanModal: () => null }));
vi.mock('@widgets/add-blend-modal', () => ({ AddBlendModal: () => null }));
vi.mock('@widgets/blend-list/ui/BlendList', () => ({ BlendList: () => null }));
vi.mock('@widgets/products-table', () => ({ ProductsTable: () => null }));
vi.mock('@features/blend-roasted', () => ({ BlendRoastedModal: () => null }));
vi.mock('./ui/RoastedInventoryTab', () => ({ RoastedInventoryTab: () => null }));
vi.mock('./ui/InventoryLocked', () => ({ InventoryLocked: () => null }));

describe('Beans page wires all-hidden empty states', () => {
    let host: HTMLDivElement;
    let teardown: () => void;
    let qc: QueryClient;

    beforeEach(() => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const mounted = mountUi(createElement(QueryClientProvider, { client: qc }, createElement(Beans)));
        host = mounted.host;
        teardown = mounted.teardown;
    });

    afterEach(() => {
        teardown();
        qc.clear();
    });

    it('shows list and detail all-hidden messages when every bean is hidden', () => {
        const text = host.textContent ?? '';
        expect(text).toContain('beanList.allHidden');
        expect(text).toContain('beanDetail.empty.allHidden');
        expect(text).not.toContain('beanList.empty');
        expect(text).not.toContain('beanDetail.empty.addFirst');
    });
});
