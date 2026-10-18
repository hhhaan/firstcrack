// @vitest-environment jsdom
import type { Bean } from '@shared/types/database.types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Beans } from './Beans';

const BEAN_ID = 'bean-hidden-1';

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

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
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
    useCatalogVisibility: () => ({
        hidden: new Set([BEAN_ID]),
        setHidden: vi.fn(),
    }),
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

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Beans green inventory when every bean is hidden', () => {
    let host: HTMLDivElement;
    let root: Root;
    let qc: QueryClient;

    beforeEach(() => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Beans))));
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        qc.clear();
    });

    it('shows all-hidden empty states in the list and detail, not first-bean copy', () => {
        const text = host.textContent ?? '';
        expect(text).toContain('beanList.allHidden');
        expect(text).toContain('beanDetail.empty.allHidden');
        expect(text).not.toContain('beanList.empty');
        expect(text).not.toContain('beanDetail.empty.addFirst');
    });
});
